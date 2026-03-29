import { createHmac } from "crypto";
import { db } from "@/server/db";
import type { AgentIntegration } from "@/server/agents/integrations";
import {
  getActiveAgentIntegration,
  getAgentIntegrationById
} from "@/server/agents/integrations";
import { resolveDeliveryLimit } from "@/server/agents/throughput";

type EnqueueArgs = {
  eventType: string;
  payload: Record<string, unknown>;
  integrationId?: string | null;
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

export async function enqueueAgentEvent({ eventType, payload, integrationId }: EnqueueArgs) {
  const integration = integrationId
    ? await getAgentIntegrationById(integrationId)
    : await getActiveAgentIntegration();

  if (!integration || integration.status !== "active") {
    return null;
  }

  const result = await db.query(
    `INSERT INTO agent_outbox (integration_id, event_type, payload)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [integration.id, eventType, payload]
  );

  return result.rows[0]?.id ?? null;
}

async function lockPendingEvents(
  integrationId: string,
  limit: number,
  processingRecoverySeconds: number
): Promise<Array<{ id: string; payload: Record<string, unknown>; attempt_count: number }>> {
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
           AND (
             (status = 'pending' AND next_attempt_at <= now())
             OR (
               status = 'processing'
               AND updated_at <= now() - make_interval(secs => $3::int)
             )
           )
         ORDER BY created_at ASC
         LIMIT $2
         FOR UPDATE SKIP LOCKED
       )
       RETURNING id, payload, attempt_count`,
      [integrationId, limit, processingRecoverySeconds]
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

export async function deliverPendingAgentEvents({ integrationId, limit = 5 }: DeliverArgs = {}) {
  const integration = integrationId
    ? await getAgentIntegrationById(integrationId)
    : await getActiveAgentIntegration();

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
      delivered += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Delivery failed";
      const attempts = event.attempt_count + 1;
      await markFailed(event.id, attempts, message);
    }
  }

  return { delivered, skipped: pending.length - delivered, limitUsed };
}

export async function listFailedAgentEvents(integrationId: string, limit = 50) {
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
       payload
     FROM agent_outbox
     WHERE integration_id = $1
       AND status = 'failed'
     ORDER BY updated_at DESC
     LIMIT $2`,
    [integrationId, normalizedLimit]
  );
  return result.rows;
}

type RetryFailedAgentOutboxInput = {
  integrationId: string;
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
               AND status = 'failed'
               AND id::text = ANY($2::text[])
             RETURNING id`,
            [input.integrationId, eventIds]
          )
        : await client.query<{ id: string }>(
            `WITH failed AS (
               SELECT id
               FROM agent_outbox
               WHERE integration_id = $1
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
            [input.integrationId, normalizedLimit]
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
