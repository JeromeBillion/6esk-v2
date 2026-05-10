import { createHash } from "crypto";
import { z } from "zod";
import { getAgentFromRequest } from "@/server/agents/auth";
import { createDraft } from "@/server/agents/drafts";
import { hasMailboxScope } from "@/server/agents/scopes";
import { isAutoSendAllowed } from "@/server/agents/policy";
import { buildAgentEvent } from "@/server/agents/events";
import { deliverPendingAgentEvents, enqueueAgentEvent } from "@/server/agents/outbox";
import { recordAuditLog } from "@/server/audit";
import { db } from "@/server/db";
import { sendTicketReply } from "@/server/email/replies";
import { addTagsToTicket, getTicketById, recordTicketEvent } from "@/server/tickets";
import { getCustomerById } from "@/server/customers";
import { linkTickets, mergeCustomers, MergeError, mergeTickets } from "@/server/merges";
import { createMergeReviewTask, MergeReviewError } from "@/server/merge-reviews";
import {
  getTicketCallOptions,
  queueOutboundCall,
  resolveCallPhoneForRequest
} from "@/server/calls/service";
import { deliverPendingCallEvents } from "@/server/calls/outbox";
import { getLatestVoiceConsentState } from "@/server/calls/consent";
import { evaluateVoiceCallPolicy } from "@/server/calls/policy";
import { redactPhoneNumber } from "@/server/calls/redaction";
import { checkModuleEntitlement } from "@/server/tenant/module-guard";
import { recordModuleUsageEvent, resolveAiProviderMode } from "@/server/module-metering";

const actionSchema = z.object({
  type: z.enum([
    "draft_reply",
    "send_reply",
    "initiate_call",
    "set_tags",
    "set_priority",
    "assign_to",
    "request_human_review",
    "merge_tickets",
    "link_tickets",
    "merge_customers",
    "propose_merge"
  ]),
  ticketId: z.string().uuid(),
  subject: z.string().optional().nullable(),
  text: z.string().optional().nullable(),
  html: z.string().optional().nullable(),
  template: z
    .object({
      name: z.string(),
      language: z.string(),
      components: z.array(z.record(z.unknown())).optional()
    })
    .optional()
    .nullable(),
  tags: z.array(z.string()).optional().nullable(),
  priority: z.enum(["low", "normal", "high", "urgent"]).optional().nullable(),
  assignedUserId: z.string().uuid().nullable().optional(),
  sourceTicketId: z.string().uuid().optional().nullable(),
  targetTicketId: z.string().uuid().optional().nullable(),
  sourceCustomerId: z.string().uuid().optional().nullable(),
  targetCustomerId: z.string().uuid().optional().nullable(),
  reason: z.string().max(500).optional().nullable(),
  candidateId: z.string().optional().nullable(),
  toPhone: z.string().optional().nullable(),
  fromPhone: z.string().optional().nullable(),
  idempotencyKey: z.string().max(200).optional().nullable(),
  confidence: z.number().min(0).max(1).optional().nullable(),
  metadata: z.record(z.unknown()).optional().nullable()
});

const payloadSchema = z.object({
  action: actionSchema.optional(),
  actions: z.array(actionSchema).max(10).optional()
});

type AgentAction = z.infer<typeof actionSchema>;
type ActionResult = {
  type: string;
  status: string;
  detail?: string;
  data?: Record<string, unknown>;
};
type AgentActionRolloutMode = "dry_run" | "draft_only" | "limited_auto" | "auto";

const DEFAULT_AGENT_MERGE_MIN_CONFIDENCE = 0.85;
const DEFAULT_AGENT_ACTIONS_MAX_PER_MINUTE = 120;
const DRAFT_ONLY_ROLLOUT_ACTIONS = new Set(["draft_reply", "request_human_review", "propose_merge"]);
const REQUIRED_IDEMPOTENCY_ACTIONS = new Set<AgentAction["type"]>([
  "send_reply",
  "initiate_call",
  "set_tags",
  "set_priority",
  "assign_to",
  "request_human_review",
  "propose_merge",
  "merge_tickets",
  "link_tickets",
  "merge_customers"
]);
const DEFAULT_LIMITED_AUTO_ACTIONS = new Set([
  "draft_reply",
  "request_human_review",
  "propose_merge",
  "set_tags",
  "set_priority",
  "assign_to"
]);

function getAgentMergeMinConfidence() {
  const raw = Number.parseFloat(
    process.env.AGENT_MERGE_MIN_CONFIDENCE ?? `${DEFAULT_AGENT_MERGE_MIN_CONFIDENCE}`
  );
  if (Number.isNaN(raw)) {
    return DEFAULT_AGENT_MERGE_MIN_CONFIDENCE;
  }
  if (raw < 0) return 0;
  if (raw > 1) return 1;
  return raw;
}

function readPositiveInteger(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.floor(parsed);
}

function getAgentActionsMaxPerMinute(capabilities: Record<string, unknown> | null | undefined) {
  return (
    readPositiveInteger(capabilities?.max_actions_per_minute) ??
    readPositiveInteger(capabilities?.maxActionsPerMinute) ??
    readPositiveInteger(process.env.AGENT_ACTIONS_MAX_PER_MINUTE) ??
    DEFAULT_AGENT_ACTIONS_MAX_PER_MINUTE
  );
}

async function getRecentAgentActionCount(tenantId: string, integrationId: string) {
  const result = await db.query<{ used: number | string }>(
    `SELECT COUNT(*)::int AS used
     FROM audit_logs
     WHERE tenant_id = $1
       AND data->>'agentId' = $2
       AND action LIKE 'ai_%'
       AND created_at >= now() - interval '1 minute'`,
    [tenantId, integrationId]
  );
  return Number(result.rows[0]?.used ?? 0);
}

function validateMergeSafety(
  action: { reason?: string | null; confidence?: number | null },
  minConfidence: number
) {
  if (!action.reason?.trim()) {
    return "Merge reason is required.";
  }
  if (typeof action.confidence !== "number") {
    return "Merge confidence is required.";
  }
  if (action.confidence < minConfidence) {
    return `Merge confidence ${action.confidence.toFixed(2)} is below minimum ${minConfidence.toFixed(2)}.`;
  }
  return null;
}

function readMergeProposalPreference(metadata: Record<string, unknown> | null | undefined) {
  const raw = typeof metadata?.proposalType === "string" ? metadata.proposalType.trim().toLowerCase() : "";
  if (raw === "linked_case" || raw === "linked_case_merge" || raw === "link_tickets" || raw === "link") {
    return "linked_case" as const;
  }
  if (raw === "customer_merge" || raw === "customer") {
    return "customer" as const;
  }
  if (raw === "ticket_merge" || raw === "ticket") {
    return "ticket" as const;
  }
  return null;
}

function normalizeEscalationTag(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return normalized || null;
}

function requesterEmailForConsent(value: string | null | undefined) {
  if (!value || typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim().toLowerCase();
  if (!trimmed || trimmed.startsWith("voice:") || trimmed.startsWith("whatsapp:")) {
    return null;
  }
  return trimmed;
}

function inferAgentReplyModule(input: { requesterEmail: string | null | undefined; hasTemplate: boolean }) {
  if (input.hasTemplate) {
    return "whatsapp" as const;
  }
  const requester = input.requesterEmail?.trim().toLowerCase() ?? "";
  return requester.startsWith("whatsapp:") ? ("whatsapp" as const) : ("email" as const);
}

function readOutOfHoursEscalation(policy: Record<string, unknown> | null | undefined) {
  if (!policy || typeof policy !== "object") {
    return { mode: "draft_only" as const, tag: null };
  }
  const escalation = policy.escalation;
  if (!escalation || typeof escalation !== "object") {
    return { mode: "draft_only" as const, tag: null };
  }
  const record = escalation as Record<string, unknown>;
  const mode = record.out_of_hours === "block" ? "block" : "draft_only";
  const tag = normalizeEscalationTag(record.tag);
  return { mode, tag };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function readString(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function readStringList(value: unknown) {
  if (Array.isArray(value)) {
    return value
      .map((item) => readString(item))
      .filter((item): item is string => Boolean(item));
  }
  const raw = readString(value);
  return raw ? raw.split(",").map((item) => item.trim()).filter(Boolean) : [];
}

function normalizeAgentActionRolloutMode(value: unknown): AgentActionRolloutMode | null {
  const normalized = readString(value)?.toLowerCase().replace(/-/g, "_");
  if (!normalized) return null;
  if (normalized === "dry_run" || normalized === "dryrun" || normalized === "audit_only") {
    return "dry_run";
  }
  if (normalized === "draft_only" || normalized === "review_only" || normalized === "human_review") {
    return "draft_only";
  }
  if (normalized === "limited_auto" || normalized === "limited" || normalized === "limited_auto_action") {
    return "limited_auto";
  }
  if (normalized === "auto" || normalized === "auto_send" || normalized === "full_auto") {
    return "auto";
  }
  return null;
}

function readActionRolloutModeFrom(record: Record<string, unknown> | null | undefined) {
  if (!record) return null;
  if (record.dryRun === true || record.dry_run === true) {
    return "dry_run" as const;
  }
  return (
    normalizeAgentActionRolloutMode(record.actionRolloutMode) ??
    normalizeAgentActionRolloutMode(record.action_rollout_mode) ??
    normalizeAgentActionRolloutMode(record.autonomousActionMode) ??
    normalizeAgentActionRolloutMode(record.autonomous_action_mode) ??
    normalizeAgentActionRolloutMode(record.rolloutMode) ??
    normalizeAgentActionRolloutMode(record.rollout_mode)
  );
}

function getAgentActionRolloutMode(input: {
  policy?: Record<string, unknown> | null;
  capabilities?: Record<string, unknown> | null;
}) {
  return readActionRolloutModeFrom(input.policy) ?? readActionRolloutModeFrom(input.capabilities) ?? "auto";
}

function getConfiguredLimitedAutoActions(input: {
  policy?: Record<string, unknown> | null;
  capabilities?: Record<string, unknown> | null;
}) {
  const actions = [
    ...readStringList(input.policy?.limitedAutoActions),
    ...readStringList(input.policy?.limited_auto_actions),
    ...readStringList(input.policy?.allowedAutoActions),
    ...readStringList(input.policy?.allowed_auto_actions),
    ...readStringList(input.capabilities?.limitedAutoActions),
    ...readStringList(input.capabilities?.limited_auto_actions),
    ...readStringList(input.capabilities?.allowedAutoActions),
    ...readStringList(input.capabilities?.allowed_auto_actions)
  ];
  return new Set(actions);
}

function getActionRolloutDecision(input: {
  action: AgentAction;
  rolloutMode: AgentActionRolloutMode;
  allowedLimitedAutoActions: Set<string>;
}): ActionResult | null {
  if (input.rolloutMode === "dry_run") {
    return {
      type: input.action.type,
      status: "dry_run",
      detail: "Dry-run mode; no side effects executed.",
      data: {
        rolloutMode: input.rolloutMode,
        wouldExecute: input.action.type
      }
    };
  }

  if (
    input.rolloutMode === "draft_only" &&
    !DRAFT_ONLY_ROLLOUT_ACTIONS.has(input.action.type)
  ) {
    return {
      type: input.action.type,
      status: "blocked",
      detail: "Action blocked by draft-only AI rollout mode.",
      data: {
        rolloutMode: input.rolloutMode,
        errorCode: "action_rollout_blocked"
      }
    };
  }

  if (
    input.rolloutMode === "limited_auto" &&
    !DEFAULT_LIMITED_AUTO_ACTIONS.has(input.action.type) &&
    !input.allowedLimitedAutoActions.has(input.action.type)
  ) {
    return {
      type: input.action.type,
      status: "blocked",
      detail: "Action blocked by limited auto-action rollout mode.",
      data: {
        rolloutMode: input.rolloutMode,
        errorCode: "action_rollout_blocked"
      }
    };
  }

  return null;
}

function getRequiredIdempotencyFailure(action: AgentAction): ActionResult | null {
  if (!REQUIRED_IDEMPOTENCY_ACTIONS.has(action.type) || readString(action.idempotencyKey)) {
    return null;
  }

  return {
    type: action.type,
    status: "failed",
    detail: "idempotencyKey is required for this AI action.",
    data: {
      errorCode: "idempotency_required"
    }
  };
}

async function recordRequiredIdempotencyFailure(input: {
  tenantId: string;
  integrationId: string;
  action: AgentAction;
}) {
  await recordAuditLog({
    tenantId: input.tenantId,
    action: "ai_action_idempotency_required",
    entityType: "ticket",
    entityId: input.action.ticketId,
    data: {
      agentId: input.integrationId,
      actionType: input.action.type
    }
  });
}

async function validateCustomerPairForTenant(input: {
  sourceCustomerId: string;
  targetCustomerId: string;
  tenantId: string;
}) {
  const [sourceCustomer, targetCustomer] = await Promise.all([
    getCustomerById(input.sourceCustomerId, input.tenantId),
    getCustomerById(input.targetCustomerId, input.tenantId)
  ]);
  if (!sourceCustomer || !targetCustomer) {
    return "Source or target customer not found for customer merge.";
  }
  return null;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function extractCallSessionId(metadata: Record<string, unknown> | null | undefined) {
  const root = asRecord(metadata);
  if (!root) return null;

  const direct =
    readString(root.callSessionId) ??
    readString(root.call_session_id) ??
    readString(root.voiceCallSessionId);
  if (direct && UUID_PATTERN.test(direct)) {
    return direct;
  }

  const call = asRecord(root.call);
  const nested = readString(call?.id) ?? readString(call?.callSessionId);
  if (nested && UUID_PATTERN.test(nested)) {
    return nested;
  }

  return null;
}

function normalizeForStableJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeForStableJson(item));
  }
  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entryValue]) => [key, normalizeForStableJson(entryValue)])
  );
}

function stableStringify(value: unknown) {
  return JSON.stringify(normalizeForStableJson(value));
}

function buildActionRequestHash(action: AgentAction) {
  return createHash("sha256")
    .update(stableStringify({ ...action, idempotencyKey: undefined }))
    .digest("hex");
}

function shouldUseActionIdempotency(action: AgentAction) {
  const idempotencyKey = readString(action.idempotencyKey);
  if (!idempotencyKey) return null;

  if (action.type === "initiate_call") {
    return null;
  }
  if (action.type === "request_human_review" && extractCallSessionId(action.metadata ?? null)) {
    return null;
  }

  return idempotencyKey;
}

function isActionResult(value: unknown): value is ActionResult {
  const record = asRecord(value);
  return Boolean(record && typeof record.type === "string" && typeof record.status === "string");
}

function withDedupedData(result: ActionResult, idempotencyKey: string): ActionResult {
  return {
    ...result,
    data: {
      ...(result.data ?? {}),
      idempotencyKey,
      deduplicated: true
    }
  };
}

type ActionIdempotencyClaim =
  | { mode: "new"; idempotencyKey: string; requestHash: string }
  | { mode: "duplicate"; response: ActionResult }
  | { mode: "conflict"; idempotencyKey: string };
type NewActionIdempotencyClaim = Extract<ActionIdempotencyClaim, { mode: "new" }>;

async function claimAgentActionIdempotency(input: {
  tenantId: string;
  integrationId: string;
  action: AgentAction;
  idempotencyKey: string;
}): Promise<ActionIdempotencyClaim> {
  const requestHash = buildActionRequestHash(input.action);
  const claimed = await db.query<{ id: string }>(
    `INSERT INTO agent_action_idempotency (
       tenant_id,
       integration_id,
       idempotency_key,
       action_type,
       ticket_id,
       request_hash
     ) VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (tenant_id, integration_id, idempotency_key) DO NOTHING
     RETURNING id`,
    [
      input.tenantId,
      input.integrationId,
      input.idempotencyKey,
      input.action.type,
      input.action.ticketId,
      requestHash
    ]
  );

  if (claimed.rows[0]?.id) {
    return { mode: "new", idempotencyKey: input.idempotencyKey, requestHash };
  }

  const existing = await db.query<{
    request_hash: string;
    status: string;
    response: ActionResult | null;
  }>(
    `SELECT request_hash, status, response
     FROM agent_action_idempotency
     WHERE tenant_id = $1
       AND integration_id = $2
       AND idempotency_key = $3`,
    [input.tenantId, input.integrationId, input.idempotencyKey]
  );
  const existingRow = existing.rows[0];
  if (!existingRow) {
    return {
      mode: "duplicate",
      response: {
        type: input.action.type,
        status: "processing",
        detail: "A matching action is already processing.",
        data: { idempotencyKey: input.idempotencyKey, deduplicated: true }
      }
    };
  }

  await db.query(
    `UPDATE agent_action_idempotency
     SET last_seen_at = now(),
         updated_at = now()
     WHERE tenant_id = $1
       AND integration_id = $2
       AND idempotency_key = $3`,
    [input.tenantId, input.integrationId, input.idempotencyKey]
  );

  if (existingRow.request_hash !== requestHash) {
    return { mode: "conflict", idempotencyKey: input.idempotencyKey };
  }

  if (isActionResult(existingRow.response)) {
    return {
      mode: "duplicate",
      response: withDedupedData(existingRow.response, input.idempotencyKey)
    };
  }

  return {
    mode: "duplicate",
    response: {
      type: input.action.type,
      status: existingRow.status === "failed" ? "failed" : "processing",
      detail: "A matching action is already processing.",
      data: { idempotencyKey: input.idempotencyKey, deduplicated: true }
    }
  };
}

async function completeAgentActionIdempotency(input: {
  tenantId: string;
  integrationId: string;
  idempotencyKey: string;
  requestHash: string;
  result: ActionResult;
}) {
  await db.query(
    `UPDATE agent_action_idempotency
     SET status = $5,
         response = $6::jsonb,
         last_seen_at = now(),
         updated_at = now()
     WHERE tenant_id = $1
       AND integration_id = $2
       AND idempotency_key = $3
       AND request_hash = $4`,
    [
      input.tenantId,
      input.integrationId,
      input.idempotencyKey,
      input.requestHash,
      input.result.status === "failed" ? "failed" : "completed",
      JSON.stringify(input.result)
    ]
  );
}

async function completeForbiddenActionIdempotency(input: {
  tenantId: string;
  integrationId: string;
  action: AgentAction;
  claim: NewActionIdempotencyClaim | null;
}) {
  if (!input.claim) return;
  await completeAgentActionIdempotency({
    tenantId: input.tenantId,
    integrationId: input.integrationId,
    idempotencyKey: input.claim.idempotencyKey,
    requestHash: input.claim.requestHash,
    result: {
      type: input.action.type,
      status: "forbidden",
      detail: "Forbidden"
    }
  });
}

export async function POST(request: Request) {
  const integration = await getAgentFromRequest(request);
  if (!integration) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (integration.status !== "active") {
    return Response.json({ error: "Integration paused" }, { status: 403 });
  }
  const tenantId = integration.tenant_id;
  if (!tenantId) {
    return Response.json({ error: "Integration tenant missing" }, { status: 403 });
  }
  if (!(await checkModuleEntitlement("aiAutomation", tenantId))) {
    return Response.json(
      {
        error: "AI automation module is not enabled for this workspace.",
        code: "module_disabled",
        module: "aiAutomation"
      },
      { status: 409 }
    );
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch (error) {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = payloadSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json({ error: "Invalid payload" }, { status: 400 });
  }

  const actions = parsed.data.actions ?? (parsed.data.action ? [parsed.data.action] : []);
  if (actions.length === 0) {
    return Response.json({ error: "No actions provided" }, { status: 400 });
  }

  const maxActionsPerMinute = getAgentActionsMaxPerMinute(integration.capabilities);
  const recentActionCount = await getRecentAgentActionCount(tenantId, integration.id);
  if (recentActionCount + actions.length > maxActionsPerMinute) {
    await recordAuditLog({
      tenantId,
      action: "ai_action_rate_limited",
      entityType: "agent_integration",
      entityId: integration.id,
      data: {
        agentId: integration.id,
        attemptedActions: actions.length,
        usedInWindow: recentActionCount,
        limit: maxActionsPerMinute,
        windowSeconds: 60
      }
    });
    return Response.json(
      {
        error: "Agent action rate limit exceeded.",
        code: "agent_action_rate_limited",
        limit: maxActionsPerMinute,
        windowSeconds: 60
      },
      { status: 429 }
    );
  }

  const results: ActionResult[] = [];
  const allowMergeActions =
    integration.capabilities?.allow_merge_actions === true ||
    integration.capabilities?.allowMergeActions === true;
  const allowVoiceActions =
    integration.capabilities?.allow_voice_actions === true ||
    integration.capabilities?.allowVoiceActions === true;
  const mergeMinConfidence = getAgentMergeMinConfidence();
  const actionRolloutMode = getAgentActionRolloutMode({
    policy: integration.policy,
    capabilities: integration.capabilities
  });
  const allowedLimitedAutoActions = getConfiguredLimitedAutoActions({
    policy: integration.policy,
    capabilities: integration.capabilities
  });

  for (const action of actions) {
    const ticket = await getTicketById(action.ticketId, tenantId);
    if (!ticket) {
      results.push({ type: action.type, status: "not_found" });
      continue;
    }

    if (!hasMailboxScope(integration, ticket.mailbox_id)) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }

    const idempotencyKey = shouldUseActionIdempotency(action);
    let idempotencyClaim: NewActionIdempotencyClaim | null = null;
    if (idempotencyKey) {
      const claim = await claimAgentActionIdempotency({
        tenantId,
        integrationId: integration.id,
        action,
        idempotencyKey
      });

      if (claim.mode === "duplicate") {
        results.push(claim.response);
        continue;
      }

      if (claim.mode === "conflict") {
        await recordAuditLog({
          tenantId,
          action: "ai_action_idempotency_conflict",
          entityType: "ticket",
          entityId: action.ticketId,
          data: {
            agentId: integration.id,
            idempotencyKey: claim.idempotencyKey,
            actionType: action.type
          }
        });
        results.push({
          type: action.type,
          status: "failed",
          detail: "idempotencyKey was already used for a different action payload.",
          data: {
            idempotencyKey: claim.idempotencyKey,
            errorCode: "idempotency_conflict"
          }
        });
        continue;
      }

      idempotencyClaim = claim;
    }

    const rolloutDecision = getActionRolloutDecision({
      action,
      rolloutMode: actionRolloutMode,
      allowedLimitedAutoActions
    });
    if (rolloutDecision) {
      await recordAuditLog({
        tenantId,
        action: rolloutDecision.status === "dry_run" ? "ai_action_dry_run" : "ai_action_rollout_blocked",
        entityType: "ticket",
        entityId: action.ticketId,
        data: {
          agentId: integration.id,
          actionType: action.type,
          rolloutMode: actionRolloutMode,
          idempotencyKey: idempotencyKey ?? null
        }
      });
      results.push(rolloutDecision);
      if (idempotencyClaim) {
        await completeAgentActionIdempotency({
          tenantId,
          integrationId: integration.id,
          idempotencyKey: idempotencyClaim.idempotencyKey,
          requestHash: idempotencyClaim.requestHash,
          result: rolloutDecision
        });
      }
      continue;
    }

    const resultStartIndex = results.length;

    switch (action.type) {
      case "draft_reply": {
        if (!action.text && !action.html && !action.template) {
          results.push({ type: action.type, status: "failed", detail: "Missing draft body" });
          break;
        }
        const draftMetadata = action.template
          ? { ...(action.metadata ?? {}), template: action.template }
          : (action.metadata ?? null);
        await createDraft({
          tenantId,
          integrationId: integration.id,
          ticketId: action.ticketId,
          subject: action.subject ?? null,
          bodyText: action.text ?? null,
          bodyHtml: action.html ?? null,
          confidence: action.confidence ?? null,
          metadata: draftMetadata
        });
        await recordTicketEvent({
          tenantId,
          ticketId: action.ticketId,
          eventType: "ai_draft_created",
          data: { agentId: integration.id, confidence: action.confidence ?? null }
        });
        await recordAuditLog({
          tenantId,
          action: "ai_draft_created",
          entityType: "ticket",
          entityId: action.ticketId,
          data: { agentId: integration.id }
        });
        await recordModuleUsageEvent({
          tenantId,
          moduleKey: "aiAutomation",
          usageKind: "draft_reply",
          actorType: "ai",
          providerMode: resolveAiProviderMode(action.metadata ?? null),
          metadata: {
            route: "/api/agent/v1/actions",
            ticketId: action.ticketId,
            actionType: action.type,
            integrationId: integration.id
          }
        });
        results.push({ type: action.type, status: "ok" });
        break;
      }
      case "send_reply": {
        if (integration.policy_mode !== "auto_send") {
          results.push({ type: action.type, status: "blocked", detail: "Auto-send disabled" });
          break;
        }
        const replyModule = inferAgentReplyModule({
          requesterEmail: ticket.requester_email,
          hasTemplate: Boolean(action.template)
        });
        if (!(await checkModuleEntitlement(replyModule, tenantId))) {
          results.push({
            type: action.type,
            status: "blocked",
            detail: `${replyModule === "whatsapp" ? "WhatsApp" : "Email"} module disabled`
          });
          break;
        }

        if (!isAutoSendAllowed(integration)) {
          const escalation = readOutOfHoursEscalation(integration.policy);
          if (escalation.mode === "draft_only" && (action.text || action.html || action.template)) {
            const idempotencyFailure = getRequiredIdempotencyFailure(action);
            if (idempotencyFailure) {
              await recordRequiredIdempotencyFailure({
                tenantId,
                integrationId: integration.id,
                action
              });
              results.push(idempotencyFailure);
              break;
            }
            const draftMetadata = action.template
              ? { ...(action.metadata ?? {}), template: action.template }
              : (action.metadata ?? null);
            await createDraft({
              tenantId,
              integrationId: integration.id,
              ticketId: action.ticketId,
              subject: action.subject ?? null,
              bodyText: action.text ?? null,
              bodyHtml: action.html ?? null,
              confidence: action.confidence ?? null,
              metadata: draftMetadata
            });
            await recordTicketEvent({
              tenantId,
              ticketId: action.ticketId,
              eventType: "ai_draft_created",
              data: {
                agentId: integration.id,
                confidence: action.confidence ?? null,
                source: "out_of_hours_escalation"
              }
            });
            if (escalation.tag) {
              await addTagsToTicket(action.ticketId, [escalation.tag]);
              await recordTicketEvent({
                tenantId,
                ticketId: action.ticketId,
                eventType: "tags_assigned",
                data: { tags: [escalation.tag], source: "out_of_hours_escalation" }
              });
            }
            await recordAuditLog({
              tenantId,
              action: "ai_reply_escalated_out_of_hours",
              entityType: "ticket",
              entityId: action.ticketId,
              data: {
                agentId: integration.id,
                escalationMode: escalation.mode,
                escalationTag: escalation.tag
              }
            });
            results.push({
              type: action.type,
              status: "blocked",
              detail: escalation.tag
                ? `Outside working hours; draft created and tagged ${escalation.tag}`
                : "Outside working hours; draft created for review"
            });
            break;
          }
          results.push({ type: action.type, status: "blocked", detail: "Outside working hours" });
          break;
        }
        const idempotencyFailure = getRequiredIdempotencyFailure(action);
        if (idempotencyFailure) {
          await recordRequiredIdempotencyFailure({
            tenantId,
            integrationId: integration.id,
            action
          });
          results.push(idempotencyFailure);
          break;
        }
        try {
          await sendTicketReply({
            tenantId,
            ticketId: action.ticketId,
            subject: action.subject ?? null,
            text: action.text ?? null,
            html: action.html ?? null,
            template: action.template ?? null,
            origin: "ai",
            aiMeta: {
              agentId: integration.id,
              confidence: action.confidence ?? null,
              metadata: action.metadata ?? null
            }
          });
          await recordAuditLog({
            tenantId,
            action: "ai_reply_sent",
            entityType: "ticket",
            entityId: action.ticketId,
            data: { agentId: integration.id }
          });
          await recordModuleUsageEvent({
            tenantId,
            moduleKey: replyModule,
            usageKind: "reply_sent",
            actorType: "ai",
            metadata: {
              route: "/api/agent/v1/actions",
              ticketId: action.ticketId,
              actionType: action.type,
              channel: replyModule
            }
          });
          await recordModuleUsageEvent({
            tenantId,
            moduleKey: "aiAutomation",
            usageKind: "send_reply",
            actorType: "ai",
            providerMode: resolveAiProviderMode(action.metadata ?? null),
            metadata: {
              route: "/api/agent/v1/actions",
              ticketId: action.ticketId,
              actionType: action.type,
              integrationId: integration.id,
              channel: replyModule
            }
          });
          results.push({ type: action.type, status: "ok" });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Failed to send";
          results.push({ type: action.type, status: "failed", detail: message });
        }
        break;
      }
      case "initiate_call": {
        if (!allowVoiceActions) {
          results.push({
            type: action.type,
            status: "blocked",
            detail: "Voice actions disabled"
          });
          break;
        }
        if (!(await checkModuleEntitlement("voice", tenantId))) {
          results.push({
            type: action.type,
            status: "blocked",
            detail: "Voice module disabled"
          });
          break;
        }

        if (!action.reason?.trim()) {
          results.push({
            type: action.type,
            status: "failed",
            detail: "Call reason is required."
          });
          break;
        }

        const callOptions = await getTicketCallOptions(action.ticketId, tenantId);
        if (!callOptions) {
          results.push({
            type: action.type,
            status: "not_found",
            detail: "Ticket not found."
          });
          break;
        }

        const resolved = resolveCallPhoneForRequest({
          options: callOptions,
          candidateId: action.candidateId ?? null,
          toPhone: action.toPhone ?? null
        });

        if (resolved.status === "selection_required") {
          results.push({
            type: action.type,
            status: "selection_required",
            detail: resolved.detail,
            data: {
              defaultCandidateId: resolved.defaultCandidateId,
              candidates: resolved.candidates
            }
          });
          break;
        }

        if (resolved.status === "failed") {
          results.push({
            type: action.type,
            status: "failed",
            detail: resolved.detail
          });
          break;
        }

        const aiDefaultMaxCallsPerHour = Number(process.env.CALLS_AI_MAX_CALLS_PER_HOUR ?? "0");
        const consentState = await getLatestVoiceConsentState({
          customerId: ticket.customer_id ?? null,
          phone: resolved.phone,
          email: requesterEmailForConsent(ticket.requester_email)
        });
        const policyCheck = await evaluateVoiceCallPolicy({
          actor: "ai",
          policy: integration.policy ?? null,
          ticketMetadata: (ticket.metadata as Record<string, unknown> | null) ?? null,
          consentState,
          selectedCandidateId: resolved.selectedCandidateId ?? null,
          actorIntegrationId: integration.id,
          defaultMaxCallsPerHour: Number.isFinite(aiDefaultMaxCallsPerHour)
            ? aiDefaultMaxCallsPerHour
            : null
        });
        if (!policyCheck.allowed) {
          results.push({
            type: action.type,
            status: "blocked",
            detail: policyCheck.detail,
            data: { errorCode: policyCheck.code }
          });
          break;
        }
        const idempotencyFailure = getRequiredIdempotencyFailure(action);
        if (idempotencyFailure) {
          await recordRequiredIdempotencyFailure({
            tenantId,
            integrationId: integration.id,
            action
          });
          results.push(idempotencyFailure);
          break;
        }

        try {
          const queued = await queueOutboundCall({
            ticketId: action.ticketId,
            tenantId,
            toPhone: resolved.phone,
            fromPhone: action.fromPhone ?? null,
            reason: action.reason,
            idempotencyKey: action.idempotencyKey ?? null,
            origin: "ai",
            actorIntegrationId: integration.id,
            metadata: {
              ...(action.metadata ?? {}),
              selectedCandidateId: resolved.selectedCandidateId
            }
          });
          void deliverPendingCallEvents({ limit: 5 }).catch(() => {});
          await recordAuditLog({
            tenantId,
            action: "ai_call_queued",
            entityType: "call_session",
            entityId: queued.callSessionId,
            data: {
              agentId: integration.id,
              ticketId: action.ticketId,
              toPhone: redactPhoneNumber(queued.toPhone),
              idempotent: queued.idempotent
            }
          });
          await recordModuleUsageEvent({
            tenantId,
            moduleKey: "voice",
            usageKind: "call_queued",
            actorType: "ai",
            metadata: {
              route: "/api/agent/v1/actions",
              ticketId: action.ticketId,
              actionType: action.type,
              integrationId: integration.id,
              callSessionId: queued.callSessionId,
              messageId: queued.messageId,
              idempotent: queued.idempotent
            }
          });
          await recordModuleUsageEvent({
            tenantId,
            moduleKey: "aiAutomation",
            usageKind: "initiate_call",
            actorType: "ai",
            providerMode: resolveAiProviderMode(action.metadata ?? null),
            metadata: {
              route: "/api/agent/v1/actions",
              ticketId: action.ticketId,
              actionType: action.type,
              integrationId: integration.id,
              callSessionId: queued.callSessionId,
              messageId: queued.messageId
            }
          });
          results.push({
            type: action.type,
            status: "ok",
            data: {
              callSessionId: queued.callSessionId,
              messageId: queued.messageId,
              toPhone: queued.toPhone,
              idempotent: queued.idempotent
            }
          });
        } catch (error) {
          const detail =
            error instanceof Error ? error.message : "Failed to queue outbound voice call";
          results.push({
            type: action.type,
            status: "failed",
            detail
          });
        }
        break;
      }
      case "set_tags": {
        const tags = action.tags ?? [];
        if (!tags.length) {
          results.push({ type: action.type, status: "failed", detail: "No tags provided" });
          break;
        }
        const idempotencyFailure = getRequiredIdempotencyFailure(action);
        if (idempotencyFailure) {
          await recordRequiredIdempotencyFailure({
            tenantId,
            integrationId: integration.id,
            action
          });
          results.push(idempotencyFailure);
          break;
        }
        await addTagsToTicket(action.ticketId, tags);
        await recordTicketEvent({
          tenantId,
          ticketId: action.ticketId,
          eventType: "tags_assigned",
          data: { tags }
        });
        await recordAuditLog({
          tenantId,
          action: "ai_tags_set",
          entityType: "ticket",
          entityId: action.ticketId,
          data: { agentId: integration.id, tags }
        });
        results.push({ type: action.type, status: "ok" });
        break;
      }
      case "set_priority": {
        if (!action.priority) {
          results.push({ type: action.type, status: "failed", detail: "Missing priority" });
          break;
        }
        const idempotencyFailure = getRequiredIdempotencyFailure(action);
        if (idempotencyFailure) {
          await recordRequiredIdempotencyFailure({
            tenantId,
            integrationId: integration.id,
            action
          });
          results.push(idempotencyFailure);
          break;
        }
        await db.query("UPDATE tickets SET priority = $1, updated_at = now() WHERE id = $2 AND tenant_id = $3", [
          action.priority,
          action.ticketId,
          tenantId
        ]);
        await recordTicketEvent({
          tenantId,
          ticketId: action.ticketId,
          eventType: "priority_updated",
          data: { to: action.priority }
        });
        await recordAuditLog({
          tenantId,
          action: "ai_priority_set",
          entityType: "ticket",
          entityId: action.ticketId,
          data: { agentId: integration.id, priority: action.priority }
        });
        results.push({ type: action.type, status: "ok" });
        break;
      }
      case "assign_to": {
        const idempotencyFailure = getRequiredIdempotencyFailure(action);
        if (idempotencyFailure) {
          await recordRequiredIdempotencyFailure({
            tenantId,
            integrationId: integration.id,
            action
          });
          results.push(idempotencyFailure);
          break;
        }
        await db.query(
          "UPDATE tickets SET assigned_user_id = $1, updated_at = now() WHERE id = $2 AND tenant_id = $3",
          [action.assignedUserId ?? null, action.ticketId, tenantId]
        );
        await recordTicketEvent({
          tenantId,
          ticketId: action.ticketId,
          eventType: "assignment_updated",
          data: { to: action.assignedUserId ?? null }
        });
        await recordAuditLog({
          tenantId,
          action: "ai_assignment_set",
          entityType: "ticket",
          entityId: action.ticketId,
          data: { agentId: integration.id, assignedUserId: action.assignedUserId ?? null }
        });
        results.push({ type: action.type, status: "ok" });
        break;
      }
      case "request_human_review": {
        const reviewMetadata = (action.metadata as Record<string, unknown> | null) ?? null;
        const callSessionId = extractCallSessionId(reviewMetadata);
        const idempotencyKey = readString(action.idempotencyKey);

        if (callSessionId && !idempotencyKey) {
          results.push({
            type: action.type,
            status: "failed",
            detail: "idempotencyKey is required when metadata.callSessionId is provided."
          });
          break;
        }

        if (callSessionId && idempotencyKey) {
          const claimed = await db.query<{ id: string }>(
            `INSERT INTO call_review_writebacks (
               tenant_id, ticket_id, call_session_id, idempotency_key, payload
             ) VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (tenant_id, call_session_id, idempotency_key) DO NOTHING
             RETURNING id`,
            [tenantId, action.ticketId, callSessionId, idempotencyKey, reviewMetadata ?? {}]
          );
          if (!claimed.rows[0]?.id) {
            await db.query(
              `UPDATE call_review_writebacks
               SET last_seen_at = now(),
                   updated_at = now()
               WHERE tenant_id = $1
                 AND call_session_id = $2
                 AND idempotency_key = $3`,
              [tenantId, callSessionId, idempotencyKey]
            );
            await recordAuditLog({
              tenantId,
              action: "ai_review_writeback_deduplicated",
              entityType: "call_session",
              entityId: callSessionId,
              data: {
                agentId: integration.id,
                ticketId: action.ticketId,
                idempotencyKey
              }
            });
            results.push({
              type: action.type,
              status: "ok",
              detail: "Duplicate review writeback ignored.",
              data: {
                callSessionId,
                idempotencyKey,
                deduplicated: true
              }
            });
            break;
          }
        }
        const idempotencyFailure = getRequiredIdempotencyFailure(action);
        if (idempotencyFailure) {
          await recordRequiredIdempotencyFailure({
            tenantId,
            integrationId: integration.id,
            action
          });
          results.push(idempotencyFailure);
          break;
        }

        await recordTicketEvent({
          tenantId,
          ticketId: action.ticketId,
          eventType: "ai_review_requested",
          data: reviewMetadata
        });
        await recordAuditLog({
          tenantId,
          action: "ai_review_requested",
          entityType: "ticket",
          entityId: action.ticketId,
          data: {
            agentId: integration.id,
            metadata: reviewMetadata,
            callSessionId,
            idempotencyKey
          }
        });
        results.push({
          type: action.type,
          status: "ok",
          data:
            callSessionId && idempotencyKey
              ? {
                  callSessionId,
                  idempotencyKey,
                  deduplicated: false
                }
              : undefined
        });
        break;
      }
      case "propose_merge": {
        const preferredProposalType = readMergeProposalPreference(action.metadata ?? null);
        const hasCustomerPair = Boolean(action.sourceCustomerId && action.targetCustomerId);
        const proposedSourceTicketId = action.sourceTicketId ?? action.ticketId;
        const hasTicketPair = Boolean(proposedSourceTicketId && action.targetTicketId);

        if (hasCustomerPair && hasTicketPair && !preferredProposalType) {
          results.push({
            type: action.type,
            status: "failed",
            detail: "Provide either ticket merge fields or customer merge fields, not both."
          });
          break;
        }
        if (!hasCustomerPair && !hasTicketPair) {
          results.push({
            type: action.type,
            status: "failed",
            detail:
              "Missing merge proposal target. Provide source/target ticket ids or source/target customer ids."
          });
          break;
        }
        const mergeSafetyError = validateMergeSafety(action, mergeMinConfidence);
        if (mergeSafetyError) {
          results.push({ type: action.type, status: "failed", detail: mergeSafetyError });
          break;
        }

        let reviewTaskId: string | null = null;
        let reviewProposalType: "ticket" | "customer" | "linked_case" =
          preferredProposalType ?? (hasCustomerPair ? "customer" : "ticket");
        let sourceTicketId: string | null = null;
        let targetTicketId: string | null = null;
        let sourceCustomerId: string | null = null;
        let targetCustomerId: string | null = null;
        let targetTicketMailboxId: string | null = null;

        if (reviewProposalType === "customer") {
          if (!hasCustomerPair) {
            results.push({
              type: action.type,
              status: "failed",
              detail: "Missing source or target customer id for merge proposal."
            });
            break;
          }
          sourceCustomerId = action.sourceCustomerId ?? null;
          targetCustomerId = action.targetCustomerId ?? null;
          if (!sourceCustomerId || !targetCustomerId) {
            results.push({
              type: action.type,
              status: "failed",
              detail: "Missing source or target customer id for merge proposal."
            });
            break;
          }
          const customerScopeError = await validateCustomerPairForTenant({
            sourceCustomerId,
            targetCustomerId,
            tenantId
          });
          if (customerScopeError) {
            results.push({
              type: action.type,
              status: "not_found",
              detail: customerScopeError
            });
            break;
          }
        } else {
          sourceTicketId = proposedSourceTicketId;
          targetTicketId = action.targetTicketId ?? null;
          if (!sourceTicketId || !targetTicketId) {
            results.push({
              type: action.type,
              status: "failed",
              detail: "Missing source or target ticket id for merge proposal."
            });
            break;
          }

          const sourceTicket = sourceTicketId === action.ticketId ? ticket : await getTicketById(sourceTicketId, tenantId);
          if (!sourceTicket) {
            results.push({
              type: action.type,
              status: "not_found",
              detail: "Source ticket not found for merge proposal."
            });
            break;
          }

          const targetTicket = await getTicketById(targetTicketId, tenantId);
          if (!targetTicket) {
            results.push({
              type: action.type,
              status: "not_found",
              detail: "Target ticket not found for merge proposal."
            });
            break;
          }
          targetTicketMailboxId = targetTicket.mailbox_id;
          if (
            !hasMailboxScope(integration, sourceTicket.mailbox_id) ||
            !hasMailboxScope(integration, targetTicket.mailbox_id)
          ) {
            await completeForbiddenActionIdempotency({
              tenantId,
              integrationId: integration.id,
              action,
              claim: idempotencyClaim
            });
            return Response.json({ error: "Forbidden" }, { status: 403 });
          }
        }

        const idempotencyFailure = getRequiredIdempotencyFailure(action);
        if (idempotencyFailure) {
          await recordRequiredIdempotencyFailure({
            tenantId,
            integrationId: integration.id,
            action
          });
          results.push(idempotencyFailure);
          break;
        }

        try {
          const reviewTask = await createMergeReviewTask({
            proposalType: reviewProposalType,
            ticketId: action.ticketId,
            sourceTicketId,
            targetTicketId,
            sourceCustomerId,
            targetCustomerId,
            reason: action.reason ?? null,
            confidence: action.confidence ?? null,
            metadata: action.metadata ?? null,
            proposedByAgentId: integration.id
          });
          reviewTaskId = reviewTask.id;
        } catch (error) {
          const detail =
            error instanceof MergeReviewError
              ? error.message
              : error instanceof Error
                ? error.message
                : "Failed to create merge review task";
          results.push({ type: action.type, status: "failed", detail });
          break;
        }

        await recordTicketEvent({
          tenantId,
          ticketId: action.ticketId,
          eventType: "ai_merge_proposed",
          data: {
            reviewTaskId,
            proposalType: reviewProposalType,
            sourceTicketId,
            targetTicketId,
            sourceCustomerId,
            targetCustomerId,
            metadata: action.metadata ?? null,
            confidence: action.confidence ?? null,
            reason: action.reason ?? null
          }
        });
        await recordAuditLog({
          tenantId,
          action: "ai_merge_proposed",
          entityType: "ticket",
          entityId: action.ticketId,
          data: {
            agentId: integration.id,
            reviewTaskId,
            proposalType: reviewProposalType,
            sourceTicketId,
            targetTicketId,
            sourceCustomerId,
            targetCustomerId,
            metadata: action.metadata ?? null,
            confidence: action.confidence ?? null,
            reason: action.reason ?? null
          }
        });

        const reviewEvent = buildAgentEvent({
          eventType: "merge.review.required",
          ticketId: action.ticketId,
          mailboxId: targetTicketMailboxId ?? ticket.mailbox_id,
          tenantId,
          excerpt:
            reviewProposalType === "ticket"
              ? `Merge review required for tickets ${sourceTicketId} -> ${targetTicketId}`
              : `Merge review required for customers ${sourceCustomerId} -> ${targetCustomerId}`
        });
        await enqueueAgentEvent({
          eventType: "merge.review.required",
          tenantId,
          payload: {
            ...reviewEvent,
            review: {
              id: reviewTaskId,
              proposalType: reviewProposalType,
              sourceTicketId,
              targetTicketId,
              sourceCustomerId,
              targetCustomerId,
              confidence: action.confidence ?? null,
              reason: action.reason ?? null
            }
          }
        });
        void deliverPendingAgentEvents({ tenantId }).catch(() => {});

        results.push({ type: action.type, status: "ok" });
        break;
      }
      case "merge_tickets": {
        if (!allowMergeActions) {
          results.push({ type: action.type, status: "blocked", detail: "Merge actions disabled" });
          break;
        }
        const sourceTicketId = action.sourceTicketId ?? action.ticketId;
        const targetTicketId = action.targetTicketId;
        if (!targetTicketId) {
          results.push({ type: action.type, status: "failed", detail: "Missing target ticket id" });
          break;
        }
        const mergeSafetyError = validateMergeSafety(action, mergeMinConfidence);
        if (mergeSafetyError) {
          results.push({ type: action.type, status: "failed", detail: mergeSafetyError });
          break;
        }

        const sourceTicket = sourceTicketId === action.ticketId ? ticket : await getTicketById(sourceTicketId, tenantId);
        if (!sourceTicket) {
          results.push({ type: action.type, status: "not_found", detail: "Source ticket not found" });
          break;
        }

        const targetTicket = await getTicketById(targetTicketId, tenantId);
        if (!targetTicket) {
          results.push({ type: action.type, status: "not_found", detail: "Target ticket not found" });
          break;
        }

        if (
          !hasMailboxScope(integration, sourceTicket.mailbox_id) ||
          !hasMailboxScope(integration, targetTicket.mailbox_id)
        ) {
          await completeForbiddenActionIdempotency({
            tenantId,
            integrationId: integration.id,
            action,
            claim: idempotencyClaim
          });
          return Response.json({ error: "Forbidden" }, { status: 403 });
        }
        const idempotencyFailure = getRequiredIdempotencyFailure(action);
        if (idempotencyFailure) {
          await recordRequiredIdempotencyFailure({
            tenantId,
            integrationId: integration.id,
            action
          });
          results.push(idempotencyFailure);
          break;
        }

        try {
          const result = await mergeTickets({
            sourceTicketId,
            targetTicketId,
            actorUserId: null,
            reason: action.reason ?? null
          });
          await recordAuditLog({
            tenantId,
            action: "ai_ticket_merged",
            entityType: "ticket",
            entityId: sourceTicketId,
            data: { agentId: integration.id, result }
          });
          results.push({ type: action.type, status: "ok" });
        } catch (error) {
          const detail =
            error instanceof MergeError
              ? error.message
              : error instanceof Error
                ? error.message
                : "Failed to merge tickets";
          results.push({ type: action.type, status: "failed", detail });
        }
        break;
      }
      case "link_tickets": {
        if (!allowMergeActions) {
          results.push({ type: action.type, status: "blocked", detail: "Merge actions disabled" });
          break;
        }
        const sourceTicketId = action.sourceTicketId ?? action.ticketId;
        const targetTicketId = action.targetTicketId;
        if (!targetTicketId) {
          results.push({ type: action.type, status: "failed", detail: "Missing target ticket id" });
          break;
        }
        const mergeSafetyError = validateMergeSafety(action, mergeMinConfidence);
        if (mergeSafetyError) {
          results.push({ type: action.type, status: "failed", detail: mergeSafetyError });
          break;
        }

        const sourceTicket = sourceTicketId === action.ticketId ? ticket : await getTicketById(sourceTicketId, tenantId);
        if (!sourceTicket) {
          results.push({ type: action.type, status: "not_found", detail: "Source ticket not found" });
          break;
        }

        const targetTicket = await getTicketById(targetTicketId, tenantId);
        if (!targetTicket) {
          results.push({ type: action.type, status: "not_found", detail: "Target ticket not found" });
          break;
        }

        if (
          !hasMailboxScope(integration, sourceTicket.mailbox_id) ||
          !hasMailboxScope(integration, targetTicket.mailbox_id)
        ) {
          await completeForbiddenActionIdempotency({
            tenantId,
            integrationId: integration.id,
            action,
            claim: idempotencyClaim
          });
          return Response.json({ error: "Forbidden" }, { status: 403 });
        }
        const idempotencyFailure = getRequiredIdempotencyFailure(action);
        if (idempotencyFailure) {
          await recordRequiredIdempotencyFailure({
            tenantId,
            integrationId: integration.id,
            action
          });
          results.push(idempotencyFailure);
          break;
        }

        try {
          const result = await linkTickets({
            sourceTicketId,
            targetTicketId,
            actorUserId: null,
            reason: action.reason ?? null,
            metadata: action.metadata ?? null
          });
          await recordAuditLog({
            tenantId,
            action: "ai_ticket_linked_case",
            entityType: "ticket",
            entityId: sourceTicketId,
            data: { agentId: integration.id, result }
          });
          results.push({ type: action.type, status: "ok" });
        } catch (error) {
          const detail =
            error instanceof MergeError
              ? error.message
              : error instanceof Error
                ? error.message
                : "Failed to link tickets";
          results.push({ type: action.type, status: "failed", detail });
        }
        break;
      }
      case "merge_customers": {
        if (!allowMergeActions) {
          results.push({ type: action.type, status: "blocked", detail: "Merge actions disabled" });
          break;
        }
        const sourceCustomerId = action.sourceCustomerId;
        const targetCustomerId = action.targetCustomerId;
        if (!sourceCustomerId || !targetCustomerId) {
          results.push({ type: action.type, status: "failed", detail: "Missing customer ids" });
          break;
        }
        const mergeSafetyError = validateMergeSafety(action, mergeMinConfidence);
        if (mergeSafetyError) {
          results.push({ type: action.type, status: "failed", detail: mergeSafetyError });
          break;
        }
        const customerScopeError = await validateCustomerPairForTenant({
          sourceCustomerId,
          targetCustomerId,
          tenantId
        });
        if (customerScopeError) {
          results.push({
            type: action.type,
            status: "not_found",
            detail: customerScopeError
          });
          break;
        }
        const idempotencyFailure = getRequiredIdempotencyFailure(action);
        if (idempotencyFailure) {
          await recordRequiredIdempotencyFailure({
            tenantId,
            integrationId: integration.id,
            action
          });
          results.push(idempotencyFailure);
          break;
        }
        try {
          const result = await mergeCustomers({
            sourceCustomerId,
            targetCustomerId,
            actorUserId: null,
            reason: action.reason ?? null
          });
          await recordAuditLog({
            tenantId,
            action: "ai_customer_merged",
            entityType: "ticket",
            entityId: action.ticketId,
            data: { agentId: integration.id, result }
          });
          results.push({ type: action.type, status: "ok" });
        } catch (error) {
          const detail =
            error instanceof MergeError
              ? error.message
              : error instanceof Error
                ? error.message
                : "Failed to merge customers";
          results.push({ type: action.type, status: "failed", detail });
        }
        break;
      }
      default:
        results.push({ type: action.type, status: "ignored" });
        break;
    }

    if (idempotencyClaim && results.length > resultStartIndex) {
      await completeAgentActionIdempotency({
        tenantId,
        integrationId: integration.id,
        idempotencyKey: idempotencyClaim.idempotencyKey,
        requestHash: idempotencyClaim.requestHash,
        result: results[resultStartIndex]
      });
    }
  }

  return Response.json({ status: "ok", results });
}
