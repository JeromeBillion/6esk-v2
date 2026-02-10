import { db } from "@/server/db";
import { decryptSecret } from "@/server/agents/secret";

type WhatsAppEventRow = {
  id: string;
  payload: Record<string, unknown>;
  attempt_count: number;
};

type WhatsAppAccount = {
  id: string;
  provider: string;
  phone_number: string;
  access_token: string | null;
  status: string;
};

type DeliverArgs = {
  limit?: number;
};

const GRAPH_VERSION = process.env.WHATSAPP_GRAPH_VERSION ?? "v19.0";

async function getActiveAccount() {
  const result = await db.query<WhatsAppAccount>(
    `SELECT id, provider, phone_number, access_token, status
     FROM whatsapp_accounts
     WHERE status = 'active'
     ORDER BY created_at DESC
     LIMIT 1`
  );
  return result.rows[0] ?? null;
}

async function lockPendingEvents(limit: number): Promise<WhatsAppEventRow[]> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `UPDATE whatsapp_events
       SET status = 'processing',
           last_error = NULL,
           updated_at = now()
       WHERE id IN (
         SELECT id
         FROM whatsapp_events
         WHERE direction = 'outbound'
           AND status = 'queued'
           AND next_attempt_at <= now()
         ORDER BY created_at ASC
         LIMIT $1
         FOR UPDATE SKIP LOCKED
       )
       RETURNING id, payload, attempt_count`,
      [limit]
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

async function markDelivered(eventId: string, messageRecordId?: string | null, providerMessageId?: string | null) {
  await db.query(
    `UPDATE whatsapp_events
     SET status = 'sent',
         updated_at = now()
     WHERE id = $1`,
    [eventId]
  );

  if (messageRecordId && providerMessageId) {
    await db.query(
      `UPDATE messages
       SET external_message_id = $1,
           wa_status = 'sent',
           wa_timestamp = now()
       WHERE id = $2`,
      [providerMessageId, messageRecordId]
    );
  } else if (messageRecordId) {
    await db.query(
      `UPDATE messages
       SET wa_status = 'sent',
           wa_timestamp = now()
       WHERE id = $1`,
      [messageRecordId]
    );
  }
}

async function markFailed(eventId: string, attemptCount: number, errorMessage: string, messageRecordId?: string | null) {
  const nextAttempt = new Date(Date.now() + Math.min(attemptCount, 5) * 60000);
  const status = attemptCount >= 5 ? "failed" : "queued";
  await db.query(
    `UPDATE whatsapp_events
     SET status = $1,
         attempt_count = $2,
         last_error = $3,
         next_attempt_at = $4,
         updated_at = now()
     WHERE id = $5`,
    [status, attemptCount, errorMessage.slice(0, 500), nextAttempt, eventId]
  );

  if (messageRecordId) {
    await db.query(
      `UPDATE messages
       SET wa_status = 'failed',
           wa_timestamp = now()
       WHERE id = $1`,
      [messageRecordId]
    );
  }
}

function buildMetaPayload(payload: Record<string, unknown>) {
  const to = typeof payload.to === "string" ? payload.to : "";
  const template = typeof payload.template === "object" && payload.template
    ? (payload.template as Record<string, unknown>)
    : null;
  const text = typeof payload.text === "string" ? payload.text : "";

  if (template) {
    const name = typeof template.name === "string" ? template.name : "";
    const language = typeof template.language === "string" ? template.language : "en_US";
    const components = Array.isArray(template.components) ? template.components : undefined;
    return {
      to,
      body: {
        messaging_product: "whatsapp",
        to,
        type: "template",
        template: {
          name,
          language: { code: language },
          ...(components ? { components } : {})
        }
      }
    };
  }

  return {
    to,
    body: {
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body: text }
    }
  };
}

async function sendMetaMessage(account: WhatsAppAccount, payload: Record<string, unknown>) {
  const accessToken = account.access_token ? decryptSecret(account.access_token) : "";
  if (!accessToken) {
    throw new Error("Missing WhatsApp access token");
  }
  if (!account.phone_number) {
    throw new Error("Missing WhatsApp phone number ID");
  }

  const { body, to } = buildMetaPayload(payload);
  if (!to) {
    throw new Error("Missing WhatsApp recipient");
  }

  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${account.phone_number}/messages`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(errorBody || `WhatsApp send failed (${response.status})`);
  }

  const data = (await response.json()) as {
    messages?: Array<{ id?: string }>;
  };
  const providerMessageId = data.messages?.[0]?.id ?? null;
  return { providerMessageId };
}

export async function deliverPendingWhatsAppEvents({ limit = 5 }: DeliverArgs = {}) {
  const account = await getActiveAccount();
  if (!account) {
    return { delivered: 0, skipped: 0, error: "No active WhatsApp account" };
  }

  const pending = await lockPendingEvents(limit);
  if (!pending.length) {
    return { delivered: 0, skipped: 0 };
  }

  let delivered = 0;
  for (const event of pending) {
    const payload = event.payload ?? {};
    const messageRecordId =
      typeof payload.messageRecordId === "string" ? payload.messageRecordId : null;
    try {
      if (account.provider !== "meta") {
        throw new Error(`Provider ${account.provider} not supported yet`);
      }
      const { providerMessageId } = await sendMetaMessage(account, payload);
      await markDelivered(event.id, messageRecordId, providerMessageId);
      delivered += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "WhatsApp delivery failed";
      const attempts = event.attempt_count + 1;
      await markFailed(event.id, attempts, message, messageRecordId);
    }
  }

  return { delivered, skipped: pending.length - delivered };
}
