import { createHmac } from "crypto";
import { db } from "@/server/db";
import type { AgentIntegration } from "@/server/agents/integrations";
import {
  getActiveAgentIntegration,
  getAgentIntegrationById
} from "@/server/agents/integrations";
import { resolveDeliveryLimit } from "@/server/agents/throughput";
import { processInternalDexterMessage } from "@/server/dexter-runtime";
import { DEFAULT_TENANT_ID } from "@/server/tenant/types";

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
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
    console.warn(`[AgentOutbox] Skipping tenantless agent event ${eventType}`);
    return null;
  }

  const integration = integrationId
    ? await getAgentIntegrationById(integrationId, effectiveTenantId)
    : await getActiveAgentIntegration(effectiveTenantId);

  if (!integration || integration.status !== "active") {
    return null;
  }

  const result = await db.query(
    `INSERT INTO agent_outbox (integration_id, tenant_id, event_type, payload)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [integration.id, effectiveTenantId, eventType, tenantScopedPayload(payload, effectiveTenantId)]
  );

  return result.rows[0]?.id ?? null;
}

async function lockPendingEvents(
  integrationId: string,
  tenantId: string,
  limit: number,
  processingRecoverySeconds: number
): Promise<Array<{ id: string; tenant_id: string; payload: Record<string, unknown>; attempt_count: number }>> {
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
       RETURNING id, tenant_id, payload, attempt_count`,
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

async function markDelivered(id: string) {
  await db.query(
    `UPDATE agent_outbox
     SET status = 'delivered', updated_at = now()
     WHERE id = $1`,
    [id]
  );
}

async function markFailed(id: string, attemptCount: number, errorMessage: string) {
  const nextAttempt = new Date(Date.now() + Math.min(attemptCount, 5) * 60000);
  const status = attemptCount >= 5 ? "failed" : "pending";
  await db.query(
    `UPDATE agent_outbox
     SET status = $1,
         attempt_count = $2,
         last_error = $3,
         next_attempt_at = $4,
         updated_at = now()
     WHERE id = $5`,
    [status, attemptCount, errorMessage.slice(0, 500), nextAttempt, id]
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

export async function deliverPendingAgentEvents({ integrationId, tenantId, limit = 5 }: DeliverArgs = {}) {
  const effectiveTenantId = readTenantId(tenantId) ?? DEFAULT_TENANT_ID;
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
    try {
      await postToAgent(integration, event.payload);
      await markDelivered(event.id);

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

      delivered += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Delivery failed";
      const attempts = event.attempt_count + 1;
      await markFailed(event.id, attempts, message);
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
