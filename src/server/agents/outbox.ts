import { createHmac } from "crypto";
import { db } from "@/server/db";
import type { AgentIntegration } from "@/server/agents/integrations";
import {
  getActiveAgentIntegration,
  getAgentIntegrationById
} from "@/server/agents/integrations";

type EnqueueArgs = {
  eventType: string;
  payload: Record<string, unknown>;
  integrationId?: string | null;
};

type DeliverArgs = {
  integrationId?: string | null;
  limit?: number;
};

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
  limit: number
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
         WHERE status = 'pending'
           AND integration_id = $1
           AND next_attempt_at <= now()
         ORDER BY created_at ASC
         LIMIT $2
         FOR UPDATE SKIP LOCKED
       )
       RETURNING id, payload, attempt_count`,
      [integrationId, limit]
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
    return { delivered: 0, skipped: 0 };
  }

  const pending = await lockPendingEvents(integration.id, limit);
  if (!pending.length) {
    return { delivered: 0, skipped: 0 };
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

  return { delivered, skipped: pending.length - delivered };
}
