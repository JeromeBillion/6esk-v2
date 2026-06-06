import { z } from "zod";
import { getSessionUser } from "@/server/auth/session";
import { isLeadAdmin } from "@/server/auth/roles";
import { recordAuditLog } from "@/server/audit";
import {
  getAgentIntegrationById,
  updateAgentIntegration
} from "@/server/agents/integrations";
import { DEFAULT_TENANT_ID } from "@/server/tenant/types";

const actionRolloutModeSchema = z.enum(["dry_run", "draft_only", "limited_auto", "auto"]);
const agentActionTypeSchema = z.enum([
  "draft_reply",
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

const rolloutUpdateSchema = z
  .object({
    actionRolloutMode: actionRolloutModeSchema.optional(),
    allowedAutoActions: z.array(agentActionTypeSchema).max(20).optional(),
    maxActionsPerMinute: z.number().int().min(1).max(1000).optional()
  })
  .strict()
  .refine(
    (value) =>
      value.actionRolloutMode !== undefined ||
      value.allowedAutoActions !== undefined ||
      value.maxActionsPerMinute !== undefined,
    "At least one rollout control is required."
  );

type AgentRolloutMode = z.infer<typeof actionRolloutModeSchema>;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? { ...(value as Record<string, unknown>) } : {};
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

function normalizeRolloutMode(value: unknown): AgentRolloutMode | null {
  const normalized = readString(value)?.toLowerCase().replace(/-/g, "_");
  if (!normalized) return null;
  if (normalized === "dry_run" || normalized === "dryrun" || normalized === "audit_only") return "dry_run";
  if (normalized === "draft_only" || normalized === "review_only" || normalized === "human_review") return "draft_only";
  if (normalized === "limited_auto" || normalized === "limited" || normalized === "limited_auto_action") {
    return "limited_auto";
  }
  if (normalized === "auto" || normalized === "auto_send" || normalized === "full_auto") return "auto";
  return null;
}

function readRolloutModeFrom(record: Record<string, unknown>) {
  if (record.dryRun === true || record.dry_run === true) return "dry_run" as const;
  return (
    normalizeRolloutMode(record.actionRolloutMode) ??
    normalizeRolloutMode(record.action_rollout_mode) ??
    normalizeRolloutMode(record.autonomousActionMode) ??
    normalizeRolloutMode(record.autonomous_action_mode) ??
    normalizeRolloutMode(record.rolloutMode) ??
    normalizeRolloutMode(record.rollout_mode)
  );
}

function readPositiveInteger(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.floor(parsed);
}

function uniqueActions(actions: readonly string[]) {
  const allowed = new Set(agentActionTypeSchema.options);
  return [...new Set(actions)].filter((action) => allowed.has(action as (typeof agentActionTypeSchema.options)[number]));
}

function getRolloutControls(input: {
  policy?: Record<string, unknown> | null;
  capabilities?: Record<string, unknown> | null;
}) {
  const policy = asRecord(input.policy);
  const capabilities = asRecord(input.capabilities);
  return {
    actionRolloutMode: readRolloutModeFrom(policy) ?? readRolloutModeFrom(capabilities) ?? "auto",
    allowedAutoActions: uniqueActions([
      ...readStringList(policy.limitedAutoActions),
      ...readStringList(policy.limited_auto_actions),
      ...readStringList(policy.allowedAutoActions),
      ...readStringList(policy.allowed_auto_actions),
      ...readStringList(capabilities.limitedAutoActions),
      ...readStringList(capabilities.limited_auto_actions),
      ...readStringList(capabilities.allowedAutoActions),
      ...readStringList(capabilities.allowed_auto_actions)
    ]),
    maxActionsPerMinute:
      readPositiveInteger(capabilities.max_actions_per_minute) ?? readPositiveInteger(capabilities.maxActionsPerMinute)
  };
}

function removeRolloutModeAliases(record: Record<string, unknown>) {
  delete record.dryRun;
  delete record.dry_run;
  delete record.action_rollout_mode;
  delete record.autonomousActionMode;
  delete record.autonomous_action_mode;
  delete record.rolloutMode;
  delete record.rollout_mode;
}

function removeAllowedActionAliases(record: Record<string, unknown>) {
  delete record.limitedAutoActions;
  delete record.limited_auto_actions;
  delete record.allowed_auto_actions;
}

function removeRateLimitAliases(record: Record<string, unknown>) {
  delete record.max_actions_per_minute;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ agentId: string }> }
) {
  const user = await getSessionUser();
  if (!isLeadAdmin(user)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { agentId } = await params;
  const tenantId = user?.tenant_id ?? DEFAULT_TENANT_ID;
  const agent = await getAgentIntegrationById(agentId, tenantId);
  if (!agent) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  return Response.json({
    agentId: agent.id,
    tenantId,
    rollout: getRolloutControls({
      policy: agent.policy,
      capabilities: agent.capabilities
    })
  });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ agentId: string }> }
) {
  const user = await getSessionUser();
  if (!isLeadAdmin(user)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch (error) {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = rolloutUpdateSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json({ error: "Invalid payload" }, { status: 400 });
  }

  const { agentId } = await params;
  const tenantId = user?.tenant_id ?? DEFAULT_TENANT_ID;
  const existing = await getAgentIntegrationById(agentId, tenantId);
  if (!existing) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const previousRollout = getRolloutControls({
    policy: existing.policy,
    capabilities: existing.capabilities
  });
  const policy = asRecord(existing.policy);
  const capabilities = asRecord(existing.capabilities);

  if (parsed.data.actionRolloutMode !== undefined) {
    removeRolloutModeAliases(policy);
    policy.actionRolloutMode = parsed.data.actionRolloutMode;
  }

  if (parsed.data.allowedAutoActions !== undefined) {
    removeAllowedActionAliases(policy);
    removeAllowedActionAliases(capabilities);
    policy.allowedAutoActions = uniqueActions(parsed.data.allowedAutoActions);
  }

  if (parsed.data.maxActionsPerMinute !== undefined) {
    removeRateLimitAliases(capabilities);
    capabilities.maxActionsPerMinute = parsed.data.maxActionsPerMinute;
  }

  const agent = await updateAgentIntegration(
    agentId,
    {
      policy,
      capabilities
    },
    tenantId
  );
  if (!agent) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const rollout = getRolloutControls({
    policy: agent.policy,
    capabilities: agent.capabilities
  });
  await recordAuditLog({
    tenantId,
    actorUserId: user?.id ?? null,
    action: "agent_rollout_controls_updated",
    entityType: "agent_integration",
    entityId: agent.id,
    data: {
      previous: previousRollout,
      next: rollout
    }
  });

  return Response.json({
    status: "updated",
    agentId: agent.id,
    rollout
  });
}
