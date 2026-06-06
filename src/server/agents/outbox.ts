import { createHmac } from "crypto";
import { db } from "@/server/db";
import type { AgentIntegration } from "@/server/agents/integrations";
import {
  getActiveAgentIntegration,
  getAgentIntegrationById
} from "@/server/agents/integrations";
import { resolveDeliveryLimit } from "@/server/agents/throughput";
import {
  buildAgentCommandEnvelope,
  buildLaneKey,
  extractEnvelopeResource,
  mapEventTypeToCommandType,
  readEnvelopeRunId,
  type AgentCommandEnvelope
} from "@/server/agents/command-envelope";
import {
  inspectAiInput,
  isAiGuardUnsafe,
  recordAiGuardEvent,
  serializeAiGuardValue
} from "@/server/ai/guard";
import { buildAgentKnowledgeContext } from "@/server/agents/rag-context";
import { buildAgentPromptSandboxForRuntime } from "@/server/agents/prompt-templates";
import { buildAgentCustomerContext } from "@/server/agents/customer-context";
import { resolveTenantScope, type TenantScopeInput } from "@/server/tenant-context";

type EnqueueArgs = {
  eventType: string;
  payload: Record<string, unknown>;
  integrationId?: string | null;
  tenantKey?: string | null;
  workspaceKey?: string | null;
  laneKey?: string | null;
  idempotencyKey?: string | null;
};

type DeliverArgs = {
  integrationId?: string | null;
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
  tenant_key?: string;
  workspace_key?: string;
  lane_key?: string | null;
  command_envelope?: AgentCommandEnvelope | null;
};

const DEFAULT_PROCESSING_RECOVERY_SECONDS = 300;

function getProcessingRecoverySeconds() {
  const configured = Number(process.env.AGENT_OUTBOX_PROCESSING_RECOVERY_SECONDS ?? "300");
  if (!Number.isFinite(configured) || configured <= 0) {
    return DEFAULT_PROCESSING_RECOVERY_SECONDS;
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

function scopeFromCommandEnvelope(commandEnvelope?: AgentCommandEnvelope | null) {
  return resolveTenantScope({
    tenantKey: commandEnvelope?.tenant_key,
    workspaceKey: commandEnvelope?.workspace_key
  });
}

async function recordSafetyBlockedRun(input: {
  commandEnvelope: AgentCommandEnvelope;
  eventType: string;
  payload: Record<string, unknown>;
  reasonCodes: string[];
}) {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO agent_runs (
         id,
         tenant_key,
         workspace_key,
         integration_id,
         mode,
         status,
         lane_key,
         source_event_type,
         resource,
         command_envelope,
         idempotency_key,
         error,
         completed_at
       ) VALUES (
         $1, $2, $3, $4, $5, 'blocked', $6, $7, $8, $9, $10, $11, now()
       )
       ON CONFLICT (id) DO NOTHING`,
      [
        input.commandEnvelope.run_id,
        input.commandEnvelope.tenant_key,
        input.commandEnvelope.workspace_key,
        input.commandEnvelope.integration_id,
        input.commandEnvelope.mode,
        input.commandEnvelope.lane_key,
        input.eventType,
        input.commandEnvelope.resource,
        input.commandEnvelope,
        input.commandEnvelope.idempotency_key,
        `Blocked by AI guard: ${input.reasonCodes.join(", ")}`
      ]
    );
    await client.query(
      `INSERT INTO agent_run_events (tenant_key, workspace_key, run_id, event_type, status, data)
       VALUES ($1, $2, $3, 'agent.safety.blocked', 'blocked', $4)`,
      [
        input.commandEnvelope.tenant_key,
        input.commandEnvelope.workspace_key,
        input.commandEnvelope.run_id,
        {
          eventType: input.eventType,
          reasonCodes: input.reasonCodes,
          payload: input.payload
        }
      ]
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function enqueueAgentEvent({
  eventType,
  payload,
  integrationId,
  tenantKey: requestedTenantKey,
  workspaceKey,
  laneKey: requestedLaneKey,
  idempotencyKey
}: EnqueueArgs) {
  const requestedScope = requestedTenantKey
    ? resolveTenantScope({ tenantKey: requestedTenantKey, workspaceKey })
    : null;
  const integration = integrationId
    ? await getAgentIntegrationById(integrationId, requestedScope)
    : await getActiveAgentIntegration(requestedScope);

  if (!integration || integration.status !== "active") {
    return null;
  }

  const tenantKey = requestedScope?.tenantKey || integration.tenant_key || "primary";
  const resolvedWorkspaceKey = requestedScope?.workspaceKey || workspaceKey || "primary";
  const laneKey =
    requestedLaneKey?.trim() ||
    buildLaneKey({
      tenantKey,
      eventType,
      payload
  });
  const knowledgeContext = await buildAgentKnowledgeContext({
    tenantKey,
    workspaceKey: resolvedWorkspaceKey,
    eventType,
    payload
  });
  const customerContext = await buildAgentCustomerContext({
    tenantKey,
    workspaceKey: resolvedWorkspaceKey,
    eventType,
    payload
  });
  const commandPayload = {
    ...payload,
    ...(knowledgeContext ? { knowledge_context: knowledgeContext } : {}),
    customer_context: customerContext
  };
  const commandEnvelope = buildAgentCommandEnvelope({
    commandType: mapEventTypeToCommandType(eventType),
    tenantKey,
    workspaceKey: resolvedWorkspaceKey,
    integrationId: integration.id,
    laneKey,
    policyMode: integration.policy_mode,
    idempotencyKey: idempotencyKey ?? null,
    resource: extractEnvelopeResource(payload),
    payload: commandPayload,
    policy: integration.policy
  });
  const commandSafety = inspectAiInput({
    text: serializeAiGuardValue(commandPayload),
    policyMode: commandEnvelope.mode
  });
  const safeCommandPayload = isAiGuardUnsafe(commandSafety)
    ? {
        ...commandPayload,
        safety_context: {
          guard_version: commandSafety.guardVersion,
          severity: commandSafety.severity,
          decision: commandSafety.decision,
          reason_codes: commandSafety.reasonCodes
        }
      }
    : commandPayload;
  commandEnvelope.payload = safeCommandPayload;
  commandEnvelope.prompt_sandbox = await buildAgentPromptSandboxForRuntime({
    tenantKey,
    workspaceKey: resolvedWorkspaceKey,
    mode: commandEnvelope.mode,
    eventType,
    payload: safeCommandPayload,
    policy: integration.policy,
    customerContext
  });

  if (isAiGuardUnsafe(commandSafety)) {
    await recordAiGuardEvent({
      tenantKey,
      workspaceKey: resolvedWorkspaceKey,
      runId: commandEnvelope.run_id,
      integrationId: integration.id,
      sourceKind: "agent_command_payload",
      sourceId: requestedLaneKey ?? laneKey,
      subject: eventType,
      inspection: commandSafety,
      metadata: {
        eventType,
        laneKey,
        policyMode: commandEnvelope.mode
      }
    });

    if (commandEnvelope.mode === "full_auto") {
      await recordSafetyBlockedRun({
        commandEnvelope,
        eventType,
        payload: payload,
        reasonCodes: commandSafety.reasonCodes
      });
      return null;
    }
  }

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO agent_runs (
         id,
         tenant_key,
         workspace_key,
         integration_id,
         mode,
         status,
         lane_key,
         source_event_type,
         resource,
         command_envelope,
         idempotency_key
       ) VALUES (
         $1, $2, $3, $4, $5, 'queued', $6, $7, $8, $9, $10
       )
       ON CONFLICT (id) DO NOTHING`,
      [
        commandEnvelope.run_id,
        commandEnvelope.tenant_key,
        commandEnvelope.workspace_key,
        integration.id,
        commandEnvelope.mode,
        laneKey,
        eventType,
        commandEnvelope.resource,
        commandEnvelope,
        commandEnvelope.idempotency_key
      ]
    );
    await client.query(
      `INSERT INTO agent_run_events (tenant_key, workspace_key, run_id, event_type, status, data)
       VALUES ($1, $2, $3, $4, 'queued', $5)`,
      [
        commandEnvelope.tenant_key,
        commandEnvelope.workspace_key,
        commandEnvelope.run_id,
        commandEnvelope.command_type,
        {
          eventType,
          outboxEvent: payload
        }
      ]
    );
    const result = await client.query(
      `INSERT INTO agent_outbox (
         integration_id,
         event_type,
         payload,
         tenant_key,
         workspace_key,
         lane_key,
         idempotency_key,
         command_envelope
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (integration_id, idempotency_key)
         WHERE idempotency_key IS NOT NULL
         DO UPDATE SET
          payload = EXCLUDED.payload,
          workspace_key = EXCLUDED.workspace_key,
          command_envelope = EXCLUDED.command_envelope,
          updated_at = now()
       RETURNING id`,
      [
        integration.id,
        eventType,
        safeCommandPayload,
        tenantKey,
        resolvedWorkspaceKey,
        laneKey,
        commandEnvelope.idempotency_key,
        commandEnvelope
      ]
    );
    await client.query("COMMIT");
    return result.rows[0]?.id ?? null;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function lockPendingEvents(
  integrationId: string,
  limit: number,
  processingRecoverySeconds: number,
  scopeInput?: TenantScopeInput
): Promise<
  Array<{
    id: string;
    payload: Record<string, unknown>;
    attempt_count: number;
    command_envelope: AgentCommandEnvelope | null;
  }>
> {
  const scope = scopeInput ? resolveTenantScope(scopeInput) : null;
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `WITH eligible AS (
         SELECT DISTINCT ON (COALESCE(lane_key, id::text))
           id,
           created_at
         FROM agent_outbox ao
         WHERE ao.integration_id = $1
           ${scope ? "AND ao.tenant_key = $4" : ""}
           ${scope ? "AND ao.workspace_key = $5" : ""}
           AND (
             (ao.status = 'pending' AND ao.next_attempt_at <= now())
             OR (
               ao.status = 'processing'
               AND ao.updated_at <= now() - make_interval(secs => $3::int)
             )
           )
           AND (
             ao.lane_key IS NULL
             OR NOT EXISTS (
               SELECT 1
              FROM agent_outbox active
              WHERE active.integration_id = ao.integration_id
                AND active.tenant_key = ao.tenant_key
                AND active.workspace_key = ao.workspace_key
                AND active.lane_key = ao.lane_key
                 AND active.status = 'processing'
                 AND active.updated_at > now() - make_interval(secs => $3::int)
             )
           )
           AND (
             ao.lane_key IS NULL
             OR pg_try_advisory_xact_lock(hashtext(ao.lane_key)::bigint)
           )
         ORDER BY COALESCE(ao.lane_key, ao.id::text), ao.created_at ASC
       ),
       selected AS (
         SELECT id
         FROM eligible
         ORDER BY created_at ASC
         LIMIT $2
       )
       UPDATE agent_outbox
       SET status = 'processing', updated_at = now()
       WHERE id IN (SELECT id FROM selected)
      RETURNING id, payload, attempt_count, command_envelope`,
      scope
        ? [integrationId, limit, processingRecoverySeconds, scope.tenantKey, scope.workspaceKey]
        : [integrationId, limit, processingRecoverySeconds]
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

async function markDelivered(id: string, commandEnvelope?: AgentCommandEnvelope | null) {
  const runId = readEnvelopeRunId(commandEnvelope);
  const scope = scopeFromCommandEnvelope(commandEnvelope);
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE agent_outbox
       SET status = 'delivered', updated_at = now()
       WHERE id = $1
         AND tenant_key = $2
         AND workspace_key = $3`,
      [id, scope.tenantKey, scope.workspaceKey]
    );
    if (runId) {
      await client.query(
        `UPDATE agent_runs
         SET status = 'dispatched',
             dispatched_at = COALESCE(dispatched_at, now()),
             updated_at = now()
         WHERE id = $1
           AND tenant_key = $2
           AND workspace_key = $3
           AND status IN ('queued', 'dispatch_failed')`,
        [runId, scope.tenantKey, scope.workspaceKey]
      );
      await client.query(
        `INSERT INTO agent_run_events (tenant_key, workspace_key, run_id, event_type, status, data)
         VALUES ($1, $2, $3, 'agent.gateway.delivered', 'delivered', $4)`,
        [scope.tenantKey, scope.workspaceKey, runId, { outboxId: id }]
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function markFailed(
  id: string,
  attemptCount: number,
  errorMessage: string,
  commandEnvelope?: AgentCommandEnvelope | null
) {
  const nextAttempt = new Date(Date.now() + Math.min(attemptCount, 5) * 60000);
  const status = attemptCount >= 5 ? "failed" : "pending";
  const runId = readEnvelopeRunId(commandEnvelope);
  const scope = scopeFromCommandEnvelope(commandEnvelope);
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE agent_outbox
       SET status = $1,
           attempt_count = $2,
           last_error = $3,
           next_attempt_at = $4,
           updated_at = now()
       WHERE id = $5
         AND tenant_key = $6
         AND workspace_key = $7`,
      [status, attemptCount, errorMessage.slice(0, 500), nextAttempt, id, scope.tenantKey, scope.workspaceKey]
    );
    if (runId) {
      await client.query(
        `UPDATE agent_runs
         SET status = $2,
             error = $3,
             updated_at = now()
         WHERE id = $1
           AND tenant_key = $4
           AND workspace_key = $5`,
        [
          runId,
          status === "failed" ? "dispatch_failed" : "queued",
          errorMessage.slice(0, 500),
          scope.tenantKey,
          scope.workspaceKey
        ]
      );
      await client.query(
        `INSERT INTO agent_run_events (tenant_key, workspace_key, run_id, event_type, status, data)
         VALUES ($1, $2, $3, 'agent.gateway.delivery_failed', $4, $5)`,
        [
          scope.tenantKey,
          scope.workspaceKey,
          runId,
          status,
          { outboxId: id, attemptCount, error: errorMessage.slice(0, 500) }
        ]
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function markCompletedRun(commandEnvelope?: AgentCommandEnvelope | null) {
  const runId = readEnvelopeRunId(commandEnvelope);
  if (!runId || commandEnvelope?.command_type !== "agent.run.completed") {
    return;
  }
  const scope = scopeFromCommandEnvelope(commandEnvelope);
  await db.query(
    `UPDATE agent_runs
     SET status = 'completed',
         completed_at = COALESCE(completed_at, now()),
         updated_at = now()
     WHERE id = $1
       AND tenant_key = $2
       AND workspace_key = $3`,
    [runId, scope.tenantKey, scope.workspaceKey]
  );
}

async function postToAgent(integration: AgentIntegration, payload: Record<string, unknown>) {
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

export async function deliverPendingAgentEvents(
  { integrationId, limit = 5 }: DeliverArgs = {},
  scopeInput?: TenantScopeInput
) {
  const scope = scopeInput ? resolveTenantScope(scopeInput) : null;
  const integration = integrationId
    ? await getAgentIntegrationById(integrationId, scope)
    : await getActiveAgentIntegration(scope);

  if (!integration || integration.status !== "active") {
    return { delivered: 0, skipped: 0, limitUsed: 0 };
  }

  const limitUsed = resolveDeliveryLimit({
    requestedLimit: limit,
    capabilities: integration.capabilities
  });
  const pending = await lockPendingEvents(
    integration.id,
    limitUsed,
    getProcessingRecoverySeconds(),
    scope
  );
  if (!pending.length) {
    return { delivered: 0, skipped: 0, limitUsed };
  }

  let delivered = 0;
  for (const event of pending) {
    try {
      const payload = event.command_envelope
        ? { ...event.payload, command_envelope: event.command_envelope }
        : event.payload;
      await postToAgent(integration, payload);
      await markDelivered(event.id, event.command_envelope);
      await markCompletedRun(event.command_envelope);
      delivered += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Delivery failed";
      const attempts = event.attempt_count + 1;
      await markFailed(event.id, attempts, message, event.command_envelope);
    }
  }

  return { delivered, skipped: pending.length - delivered, limitUsed };
}

export async function listFailedAgentEvents(
  integrationId: string,
  limit = 50,
  scopeInput?: TenantScopeInput
) {
  const scope = scopeInput ? resolveTenantScope(scopeInput) : null;
  const normalizedLimit = Math.min(Math.max(limit, 1), 200);
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
       payload,
       tenant_key,
       workspace_key,
       lane_key,
       command_envelope
     FROM agent_outbox
     WHERE integration_id = $1
       ${scope ? "AND tenant_key = $3" : ""}
       ${scope ? "AND workspace_key = $4" : ""}
       AND status = 'failed'
     ORDER BY updated_at DESC
     LIMIT $2`,
    scope
      ? [integrationId, normalizedLimit, scope.tenantKey, scope.workspaceKey]
      : [integrationId, normalizedLimit]
  );
  return result.rows;
}

type RetryFailedAgentOutboxInput = {
  integrationId: string;
  tenantKey?: string | null;
  workspaceKey?: string | null;
  limit?: number;
  eventIds?: string[];
};

export async function retryFailedAgentEvents(input: RetryFailedAgentOutboxInput) {
  const scope =
    input.tenantKey || input.workspaceKey
      ? resolveTenantScope({ tenantKey: input.tenantKey, workspaceKey: input.workspaceKey })
      : null;
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
               AND status = 'failed'
               ${scope ? "AND tenant_key = $3" : ""}
               ${scope ? "AND workspace_key = $4" : ""}
               AND id::text = ANY($2::text[])
             RETURNING id`,
            scope
              ? [input.integrationId, eventIds, scope.tenantKey, scope.workspaceKey]
              : [input.integrationId, eventIds]
          )
        : await client.query<{ id: string }>(
            `WITH failed AS (
               SELECT id
               FROM agent_outbox
               WHERE integration_id = $1
                 AND status = 'failed'
                 ${scope ? "AND tenant_key = $3" : ""}
                 ${scope ? "AND workspace_key = $4" : ""}
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
            scope
              ? [input.integrationId, normalizedLimit, scope.tenantKey, scope.workspaceKey]
              : [input.integrationId, normalizedLimit]
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
