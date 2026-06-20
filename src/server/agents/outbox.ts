import { createHmac } from "crypto";
import { db } from "@/server/db";
import type { AgentIntegration } from "@/server/agents/integrations";
import {
  getActiveAgentIntegration,
  getAgentIntegrationById
} from "@/server/agents/integrations";
import { buildAgentCustomerContext } from "@/server/agents/customer-context";
import {
  type AgentPromptSandboxMode
} from "@/server/agents/prompt-sandbox";
import { buildAgentPromptSandboxForRuntime } from "@/server/agents/prompt-templates";
import {
  evaluatePromptSafety,
  promptSafetyTelemetry,
  type PromptSafetyDecision
} from "@/server/ai/prompt-safety";
import {
  appendAgentRunEvent,
  completeAgentRunStep,
  createAgentRunForOutbox,
  markAgentRunCompleted,
  markAgentRunFailed,
  markAgentRunRunning,
  recordAgentRunStepStarted,
  type AgentRunStepLedger
} from "@/server/agents/run-ledger";
import {
  attachDexterRagContextToPayload,
  buildDegradedDexterRagContext,
  buildDexterRagContextForEvent,
  summarizeDexterRagContextForLedger,
  type DexterRagContext
} from "@/server/ai/dexter-rag-context";
import type { AgentOutputCustomerContext } from "@/server/agents/output-validator";
import { resolveDeliveryLimit } from "@/server/agents/throughput";
import { processInternalDexterMessage } from "@/server/dexter-runtime";
import { logger } from "@/server/logger";

import { recordModuleUsageEvent } from "@/server/module-metering";

type EnqueueArgs = {
  eventType: string;
  payload: Record<string, unknown>;
  integrationId?: string | null;
  tenantId?: string | null;
};

type DeliverArgs = {
  integrationId?: string | null;
  tenantId?: string | null;
  limit?: number;
};

export type FailedAgentOutboxEvent = {
  id: string;
  integration_id: string;
  event_type: string;
  status: string;
  attempt_count: number;
  last_error: string | null;
  next_attempt_at: Date | null;
  created_at: Date;
  updated_at: Date;
  payload: Record<string, unknown>;
};

const DEFAULT_PROCESSING_RECOVERY_SECONDS = 300;
const DEFAULT_LANE_RETRY_SECONDS = 10;
const MAX_AGENT_OUTBOX_ATTEMPTS = 5;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

class AgentDeliveryPolicyBlockedError extends Error {
  promptSafety: PromptSafetyDecision;

  constructor(promptSafety: PromptSafetyDecision) {
    const reasonCodes =
      promptSafety.flags.map((flag) => flag.code).join(", ") || "prompt_safety_denied";
    super(`Runtime prompt safety blocked agent delivery: ${reasonCodes}`);
    this.name = "AgentDeliveryPolicyBlockedError";
    this.promptSafety = promptSafety;
  }
}

function getProcessingRecoverySeconds() {
  const configured = Number(process.env.AGENT_OUTBOX_PROCESSING_RECOVERY_SECONDS ?? "300");
  if (!Number.isFinite(configured) || configured <= 0) {
    return DEFAULT_PROCESSING_RECOVERY_SECONDS;
  }
  return Math.floor(configured);
}

function getLaneRetrySeconds() {
  const configured = Number(process.env.AGENT_OUTBOX_LANE_RETRY_SECONDS ?? `${DEFAULT_LANE_RETRY_SECONDS}`);
  if (!Number.isFinite(configured) || configured <= 0) {
    return DEFAULT_LANE_RETRY_SECONDS;
  }
  return Math.floor(configured);
}

function buildWebhookUrl(baseUrl: string) {
  const trimmed = baseUrl.replace(/\/+$/, "");
  if (trimmed.includes("/hooks/6esk/events")) {
    return trimmed;
  }
  return `${trimmed}/hooks/6esk/events`;
}

function signPayload(secret: string, timestamp: string, body: string) {
  const signature = createHmac("sha256", secret)
    .update(`${timestamp}.${body}`)
    .digest("hex");
  return `sha256=${signature}`;
}

function readTenantId(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return UUID_RE.test(trimmed) ? trimmed : null;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function resolveEventTenantId(tenantId: unknown, payload: Record<string, unknown>) {
  const resource = readRecord(payload.resource);
  return (
    readTenantId(tenantId) ??
    readTenantId(payload.tenantId) ??
    readTenantId(payload.tenant_id) ??
    readTenantId(resource?.tenantId) ??
    readTenantId(resource?.tenant_id)
  );
}

function requireTenantId(value: unknown) {
  const tenantId = readTenantId(value);
  if (!tenantId) {
    throw new Error("Deliver agent outbox events requires tenantId");
  }
  return tenantId;
}

function tenantScopedPayload(payload: Record<string, unknown>, tenantId: string) {
  const resource = readRecord(payload.resource);
  return {
    ...payload,
    tenant_id: tenantId,
    resource: {
      ...(resource ?? {}),
      tenant_id: tenantId
    }
  };
}

export async function enqueueAgentEvent({ eventType, payload, integrationId, tenantId }: EnqueueArgs) {
  const effectiveTenantId = resolveEventTenantId(tenantId, payload);
  if (!effectiveTenantId) {
    logger.warn("Skipping tenantless agent outbox event", { eventType });
    return null;
  }

  const integration = integrationId
    ? await getAgentIntegrationById(integrationId, effectiveTenantId)
    : await getActiveAgentIntegration(effectiveTenantId);

  if (!integration || integration.status !== "active") {
    return null;
  }

  const scopedPayload = tenantScopedPayload(payload, effectiveTenantId);
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `INSERT INTO agent_outbox (integration_id, tenant_id, event_type, payload)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [integration.id, effectiveTenantId, eventType, scopedPayload]
    );
    const outboxId = result.rows[0]?.id ?? null;
    if (outboxId) {
      await createAgentRunForOutbox({
        client,
        tenantId: effectiveTenantId,
        integrationId: integration.id,
        outboxEventId: outboxId,
        eventType,
        payload: scopedPayload
      });
    }
    await client.query("COMMIT");
    return outboxId;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      logger.warn("Failed to roll back agent outbox enqueue transaction", {
        error: rollbackError,
        tenantId: effectiveTenantId,
        integrationId: integration.id,
        eventType
      });
    }
    throw error;
  } finally {
    client.release();
  }
}

async function lockPendingEvents(
  integrationId: string,
  tenantId: string,
  limit: number,
  processingRecoverySeconds: number
): Promise<Array<{
  id: string;
  tenant_id: string;
  integration_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  attempt_count: number;
  run_id: string | null;
}>> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `UPDATE agent_outbox
       SET status = 'processing', updated_at = now()
       WHERE id IN (
         SELECT id
         FROM agent_outbox
         WHERE integration_id = $1
           AND tenant_id = $2
           AND (
             (status = 'pending' AND next_attempt_at <= now())
             OR (
               status = 'processing'
               AND updated_at <= now() - make_interval(secs => $4::int)
             )
           )
         ORDER BY created_at ASC
         LIMIT $3
         FOR UPDATE SKIP LOCKED
       )
       RETURNING id, tenant_id, integration_id, event_type, payload, attempt_count, run_id`,
      [integrationId, tenantId, limit, processingRecoverySeconds]
    );
    await client.query("COMMIT");
    return result.rows;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function markDelivered(id: string, tenantId: string) {
  await db.query(
    `UPDATE agent_outbox
     SET status = 'delivered', updated_at = now()
     WHERE id = $1
       AND tenant_id = $2`,
    [id, tenantId]
  );
}

async function markFailed(
  id: string,
  tenantId: string,
  attemptCount: number,
  errorMessage: string,
  terminal = attemptCount >= MAX_AGENT_OUTBOX_ATTEMPTS
) {
  const effectiveAttemptCount = terminal
    ? Math.max(attemptCount, MAX_AGENT_OUTBOX_ATTEMPTS)
    : attemptCount;
  const nextAttempt = new Date(Date.now() + Math.min(attemptCount, 5) * 60000);
  const status = terminal ? "failed" : "pending";
  await db.query(
    `UPDATE agent_outbox
     SET status = $1,
         attempt_count = $2,
         last_error = $3,
         next_attempt_at = $4,
         updated_at = now()
     WHERE id = $5
       AND tenant_id = $6`,
    [status, effectiveAttemptCount, errorMessage.slice(0, 500), nextAttempt, id, tenantId]
  );
}

async function releaseLanePending(id: string, tenantId: string) {
  await db.query(
    `UPDATE agent_outbox
     SET status = 'pending',
         next_attempt_at = now() + make_interval(secs => $2::int),
         updated_at = now()
     WHERE id = $1
       AND status = 'processing'
       AND tenant_id = $3`,
    [id, getLaneRetrySeconds(), tenantId]
  );
}

async function postToAgent(integration: AgentIntegration, payload: Record<string, unknown>) {
  if (
    integration.base_url.startsWith("internal://") ||
    integration.base_url.startsWith("native://")
  ) {
    const success = await processInternalDexterMessage(payload);
    if (!success) {
      throw new Error("Internal agent processing failed or not ready");
    }
    return;
  }

  const body = JSON.stringify(payload);
  const timestamp = new Date().toISOString();
  const signature = signPayload(integration.shared_secret, timestamp, body);
  const url = buildWebhookUrl(integration.base_url);

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-6esk-signature": signature,
      "x-6esk-timestamp": timestamp,
      "x-6esk-agent-id": integration.id
    },
    body
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `HTTP ${response.status}`);
  }
}

async function recordAcceptedDeliveryBookkeepingFailure({
  tenantId,
  runId,
  eventId,
  errorMessage
}: {
  tenantId: string;
  runId: string;
  eventId: string;
  errorMessage: string;
}) {
  try {
    await appendAgentRunEvent({
      tenantId,
      runId,
      eventType: "agent.run.delivery_bookkeeping_failed",
      status: "running",
      summary: "Agent accepted event but local delivery bookkeeping failed",
      eventData: {
        outboxEventId: eventId,
        errorMessage: errorMessage.slice(0, 500)
      }
    });
  } catch (ledgerError) {
    logger.warn("Failed to append agent delivery bookkeeping failure event", {
      error: ledgerError,
      tenantId,
      runId,
      eventId
    });
  }
}

async function recordDexterRagContextAttached({
  tenantId,
  runId,
  context
}: {
  tenantId: string;
  runId: string;
  context: DexterRagContext;
}) {
  try {
    await appendAgentRunEvent({
      tenantId,
      runId,
      eventType: "agent.rag.context_attached",
      status: "running",
      summary: `Runtime knowledge context ${context.status}`,
      eventData: summarizeDexterRagContextForLedger(context)
    });
  } catch (error) {
    logger.warn("Failed to append Dexter RAG context ledger event", {
      error,
      tenantId,
      runId,
      ragStatus: context.status
    });
  }
}

function promptSandboxModeForPolicy(mode: string | null | undefined): AgentPromptSandboxMode {
  const normalized = mode?.trim().toLowerCase().replace(/-/g, "_");
  if (normalized === "dry_run" || normalized === "dryrun" || normalized === "audit_only") {
    return "dry_run";
  }
  if (normalized === "draft_only" || normalized === "review_only") {
    return "draft_only";
  }
  if (normalized === "hybrid_review" || normalized === "limited_auto" || normalized === "manual") {
    return "hybrid_review";
  }
  if (normalized === "full_auto" || normalized === "auto" || normalized === "auto_send") {
    return "full_auto";
  }
  return "hybrid_review";
}

function collectPromptSafetyFragments(value: unknown, fragments: string[], depth = 0) {
  if (fragments.length >= 80 || depth > 5 || value == null) return;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length > 0) {
      fragments.push(trimmed);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectPromptSafetyFragments(item, fragments, depth + 1);
      if (fragments.length >= 80) break;
    }
    return;
  }
  if (typeof value === "object") {
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (fragments.length >= 80) break;
      fragments.push(key);
      collectPromptSafetyFragments(item, fragments, depth + 1);
    }
  }
}

function serializeRuntimePromptSafetyInput(eventType: string, payload: Record<string, unknown>) {
  const fragments = [eventType];
  collectPromptSafetyFragments(payload, fragments);
  return fragments.join("\n").slice(0, 8000);
}

function promptSandboxModeForRuntimeSafety(
  baseMode: AgentPromptSandboxMode,
  promptSafety: PromptSafetyDecision
): AgentPromptSandboxMode {
  if (
    promptSafety.toolPolicy.mode === "read_only" ||
    promptSafety.toolPolicy.mode === "no_tools"
  ) {
    return baseMode === "dry_run" ? "dry_run" : "draft_only";
  }
  return baseMode;
}

function attachRuntimePromptSafetyToPayload(
  payload: Record<string, unknown>,
  promptSafety: PromptSafetyDecision
) {
  const metadata = readRecord(payload.metadata);
  return {
    ...payload,
    metadata: {
      ...(metadata ?? {}),
      runtimePromptSafety: promptSafetyTelemetry(promptSafety)
    }
  };
}

async function evaluateRuntimeDeliveryPromptSafety({
  tenantId,
  runId,
  eventType,
  payload
}: {
  tenantId: string;
  runId: string;
  eventType: string;
  payload: Record<string, unknown>;
}) {
  const promptSafety = evaluatePromptSafety({
    text: serializeRuntimePromptSafetyInput(eventType, payload),
    source: "agent_outbox_event"
  });
  await appendAgentRunEvent({
    tenantId,
    runId,
    eventType: "agent.prompt_safety.evaluated",
    status: promptSafety.decision === "deny" ? "failed" : "running",
    summary: `Runtime prompt safety ${promptSafety.decision}`,
    eventData: promptSafetyTelemetry(promptSafety)
  });
  if (promptSafety.decision === "deny") {
    throw new AgentDeliveryPolicyBlockedError(promptSafety);
  }
  return promptSafety;
}

function summarizeCustomerContextForLedger(context: AgentOutputCustomerContext) {
  return {
    schemaVersion: context.schemaVersion ?? "agent-customer-output-context.v1",
    channel: context.channel ?? "unknown",
    ambiguityState: context.ambiguityState ?? "ambiguous",
    hasActiveTicketId: Boolean(context.activeTicketId),
    hasCurrentCustomerId: Boolean(context.currentCustomerId),
    allowedSourceCounts: {
      ticketIds: context.allowedSourceIds?.ticketIds?.length ?? 0,
      customerIds: context.allowedSourceIds?.customerIds?.length ?? 0,
      messageIds: context.allowedSourceIds?.messageIds?.length ?? 0,
      mailboxIds: context.allowedSourceIds?.mailboxIds?.length ?? 0,
      threadIds: context.allowedSourceIds?.threadIds?.length ?? 0,
      sameCustomerHistoryTicketIds: context.sameCustomerHistoryTicketIds?.length ?? 0
    },
    profilePiiPolicy: context.profilePiiPolicy ?? "minimize",
    disallowedScopeExpansion: context.disallowedScopeExpansion ?? []
  };
}

function attachCustomerContextToPayload(
  payload: Record<string, unknown>,
  customerContext: AgentOutputCustomerContext
) {
  const metadata = readRecord(payload.metadata);
  return {
    ...payload,
    customerContext,
    metadata: {
      ...(metadata ?? {}),
      customerContext: summarizeCustomerContextForLedger(customerContext)
    }
  };
}

async function recordCustomerContextAttached({
  tenantId,
  runId,
  context
}: {
  tenantId: string;
  runId: string;
  context: AgentOutputCustomerContext;
}) {
  try {
    await appendAgentRunEvent({
      tenantId,
      runId,
      eventType: "agent.customer_context.attached",
      status: "running",
      summary: `Customer context ${context.ambiguityState ?? "ambiguous"}`,
      eventData: summarizeCustomerContextForLedger(context)
    });
  } catch (error) {
    logger.warn("Failed to append agent customer context ledger event", {
      error,
      tenantId,
      runId,
      ambiguityState: context.ambiguityState ?? "ambiguous"
    });
  }
}

async function buildDeliveryPayload({
  tenantId,
  runId,
  eventType,
  payload,
  integration
}: {
  tenantId: string;
  runId: string;
  eventType: string;
  payload: Record<string, unknown>;
  integration: AgentIntegration;
}) {
  const runtimePromptSafety = await evaluateRuntimeDeliveryPromptSafety({
    tenantId,
    runId,
    eventType,
    payload
  });
  let context: DexterRagContext;
  try {
    context = await buildDexterRagContextForEvent({
      tenantId,
      runId,
      eventType,
      payload
    });
  } catch (error) {
    context = buildDegradedDexterRagContext({ runId, eventType, payload, error });
    logger.warn("Dexter runtime knowledge retrieval degraded for agent delivery", {
      error,
      tenantId,
      runId,
      eventType
    });
  }

  await recordDexterRagContextAttached({ tenantId, runId, context });
  const payloadWithRag = attachDexterRagContextToPayload(payload, context);
  const customerContext = await buildAgentCustomerContext({
    tenantId,
    eventType,
    payload
  });
  await recordCustomerContextAttached({ tenantId, runId, context: customerContext });
  const payloadWithCustomerContext = attachRuntimePromptSafetyToPayload(
    attachCustomerContextToPayload(payloadWithRag, customerContext),
    runtimePromptSafety
  );
  const promptSandbox = await buildAgentPromptSandboxForRuntime({
    tenantId,
    runId,
    mode: promptSandboxModeForRuntimeSafety(
      promptSandboxModeForPolicy(integration.policy_mode),
      runtimePromptSafety
    ),
    eventType,
    payload: payloadWithCustomerContext,
    policy: integration.policy,
    customerContext
  });
  return {
    ...payloadWithCustomerContext,
    promptSandbox
  };
}

function runtimeTargetForIntegration(integration: AgentIntegration) {
  if (integration.base_url.startsWith("internal://")) return "internal";
  if (integration.base_url.startsWith("native://")) return "native";
  return "external_webhook";
}

async function completeDeliveryStepBestEffort({
  ledger,
  status,
  resultSummary,
  errorMessage
}: {
  ledger: AgentRunStepLedger | null;
  status: "completed" | "failed";
  resultSummary?: Record<string, unknown> | null;
  errorMessage?: string | null;
}) {
  if (!ledger) return;
  try {
    await completeAgentRunStep({
      ledger,
      status,
      resultSummary,
      errorMessage
    });
  } catch (error) {
    logger.warn("Failed to complete agent runtime delivery step ledger", {
      error,
      tenantId: ledger.tenantId,
      runId: ledger.runId,
      stepId: ledger.stepId,
      stepType: ledger.stepType,
      status
    });
  }
}

export async function deliverPendingAgentEvents({ integrationId, tenantId, limit = 5 }: DeliverArgs = {}) {
  const effectiveTenantId = requireTenantId(tenantId);
  const integration = integrationId
    ? await getAgentIntegrationById(integrationId, effectiveTenantId)
    : await getActiveAgentIntegration(effectiveTenantId);

  if (!integration || integration.status !== "active") {
    return { delivered: 0, skipped: 0, limitUsed: 0 };
  }

  const limitUsed = resolveDeliveryLimit({
    requestedLimit: limit,
    capabilities: integration.capabilities
  });
  const pending = await lockPendingEvents(
    integration.id,
    integration.tenant_id,
    limitUsed,
    getProcessingRecoverySeconds()
  );
  if (!pending.length) {
    return { delivered: 0, skipped: 0, limitUsed };
  }

  let delivered = 0;
  for (const event of pending) {
    let runId = event.run_id;
    let deliveryStep: AgentRunStepLedger | null = null;
    try {
      if (!runId) {
        const run = await createAgentRunForOutbox({
          tenantId: event.tenant_id,
          integrationId: event.integration_id,
          outboxEventId: event.id,
          eventType: event.event_type,
          payload: event.payload
        });
        runId = run.id;
      }
      const reserved = await markAgentRunRunning({
        tenantId: event.tenant_id,
        runId,
        attemptCount: event.attempt_count + 1
      });
      if (!reserved) {
        await releaseLanePending(event.id, event.tenant_id);
        continue;
      }
      const deliveryPayload = await buildDeliveryPayload({
        tenantId: event.tenant_id,
        runId,
        eventType: event.event_type,
        payload: event.payload,
        integration
      });
      deliveryStep = await recordAgentRunStepStarted({
        tenantId: event.tenant_id,
        runId,
        stepType: "runtime:deliver_event",
        summary: "Dexter runtime event delivery started",
        metadata: {
          outboxEventId: event.id,
          integrationId: event.integration_id,
          eventType: event.event_type,
          runtimeTarget: runtimeTargetForIntegration(integration),
          attemptCount: event.attempt_count + 1
        }
      });
      await postToAgent(integration, deliveryPayload);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Delivery failed";
      const attempts = event.attempt_count + 1;
      const terminal =
        error instanceof AgentDeliveryPolicyBlockedError ||
        attempts >= MAX_AGENT_OUTBOX_ATTEMPTS;
      await completeDeliveryStepBestEffort({
        ledger: deliveryStep,
        status: "failed",
        resultSummary: {
          outboxEventId: event.id,
          eventType: event.event_type,
          attemptCount: attempts
        },
        errorMessage: message
      });
      await markFailed(event.id, event.tenant_id, attempts, message, terminal);
      if (runId) {
        await markAgentRunFailed({
          tenantId: event.tenant_id,
          runId,
          errorMessage: message,
          terminal,
          attemptCount: attempts
        });
      }
      continue;
    }

    delivered += 1;
    await completeDeliveryStepBestEffort({
      ledger: deliveryStep,
      status: "completed",
      resultSummary: {
        outboxEventId: event.id,
        eventType: event.event_type,
        attemptCount: event.attempt_count + 1,
        runtimeTarget: runtimeTargetForIntegration(integration)
      }
    });

    try {
      await markDelivered(event.id, event.tenant_id);
      await markAgentRunCompleted({
        tenantId: event.tenant_id,
        runId
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Delivery bookkeeping failed";
      logger.error("Agent accepted event but local delivery bookkeeping failed", {
        tenantId: event.tenant_id,
        integrationId: event.integration_id,
        eventId: event.id,
        runId,
        errorMessage: message
      });
      if (runId) {
        await recordAcceptedDeliveryBookkeepingFailure({
          tenantId: event.tenant_id,
          runId,
          eventId: event.id,
          errorMessage: message
        });
      }
      continue;
    }

    try {
      // Record usage for FinOps as an orchestration action.
      await recordModuleUsageEvent({
        tenantId: event.tenant_id,
        moduleKey: "dexterOrchestration",
        usageKind: "agent_event_delivered",
        actorType: "system",
        quantity: 1,
        costCent: 0, // No external COGS for webhook delivery itself
        metadata: { eventId: event.id, integrationId: integration.id }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Delivery failed";
      logger.warn("Usage metering failed for delivered agent event", {
        tenantId: event.tenant_id,
        integrationId: integration.id,
        eventId: event.id,
        runId,
        errorMessage: message
      });
      if (runId) {
        try {
          await appendAgentRunEvent({
            tenantId: event.tenant_id,
            runId,
            eventType: "agent.run.usage_metering_failed",
            status: "completed",
            summary: "Usage metering failed after agent delivery completed",
            eventData: { outboxEventId: event.id, errorMessage: message.slice(0, 500) }
          });
        } catch (ledgerError) {
          logger.warn("Failed to append agent usage metering failure event", {
            error: ledgerError,
            tenantId: event.tenant_id,
            integrationId: integration.id,
            eventId: event.id,
            runId
          });
        }
      }
    }
  }

  return { delivered, skipped: pending.length - delivered, limitUsed };
}

export async function listFailedAgentEvents(integrationId: string, limit = 50, tenantId?: string | null) {
  const normalizedLimit = Math.min(Math.max(limit, 1), 200);
  const values: Array<string | number> = [integrationId];
  const tenantClause = tenantId ? "AND tenant_id = $2" : "";
  if (tenantId) {
    values.push(tenantId);
  }
  values.push(normalizedLimit);
  const result = await db.query<FailedAgentOutboxEvent>(
    `SELECT
       id,
       integration_id,
       event_type,
       status,
       attempt_count,
       last_error,
       next_attempt_at,
       created_at,
       updated_at,
       payload
     FROM agent_outbox
     WHERE integration_id = $1
       ${tenantClause}
       AND status = 'failed'
     ORDER BY updated_at DESC
     LIMIT $${values.length}`,
    values
  );
  return result.rows;
}

type RetryFailedAgentOutboxInput = {
  integrationId: string;
  tenantId?: string | null;
  limit?: number;
  eventIds?: string[];
};

export async function retryFailedAgentEvents(input: RetryFailedAgentOutboxInput) {
  const normalizedLimit = Math.min(Math.max(input.limit ?? 25, 1), 100);
  const eventIds = Array.from(
    new Set((input.eventIds ?? []).map((value) => value.trim()).filter(Boolean))
  ).slice(0, 100);
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const result =
      eventIds.length > 0
        ? await client.query<{ id: string }>(
            `UPDATE agent_outbox
             SET status = 'pending',
                 next_attempt_at = now(),
                 updated_at = now()
             WHERE integration_id = $1
               ${input.tenantId ? "AND tenant_id = $3" : ""}
               AND status = 'failed'
               AND id::text = ANY($2::text[])
             RETURNING id`,
            input.tenantId ? [input.integrationId, eventIds, input.tenantId] : [input.integrationId, eventIds]
          )
        : await client.query<{ id: string }>(
            `WITH failed AS (
               SELECT id
               FROM agent_outbox
               WHERE integration_id = $1
                 ${input.tenantId ? "AND tenant_id = $3" : ""}
                 AND status = 'failed'
               ORDER BY updated_at ASC
               LIMIT $2
               FOR UPDATE SKIP LOCKED
             )
             UPDATE agent_outbox evt
             SET status = 'pending',
                 next_attempt_at = now(),
                 updated_at = now()
             FROM failed
             WHERE evt.id = failed.id
             RETURNING evt.id`,
            input.tenantId ? [input.integrationId, normalizedLimit, input.tenantId] : [input.integrationId, normalizedLimit]
          );
    await client.query("COMMIT");
    return {
      requested: eventIds.length > 0 ? eventIds.length : normalizedLimit,
      retried: result.rows.length,
      ids: result.rows.map((row) => row.id)
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
