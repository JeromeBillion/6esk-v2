import { db } from "@/server/db";
import { decryptSecret } from "@/server/agents/secret";
import { getObjectBuffer } from "@/server/storage/r2";
import { recordModuleUsageEvent } from "@/server/module-metering";

type WhatsAppEventRow = {
  id: string;
  tenant_id: string;
  payload: Record<string, unknown>;
  attempt_count: number;
};

export type FailedWhatsAppOutboxEvent = {
  id: string;
  tenant_id: string;
  status: string;
  attempt_count: number;
  last_error: string | null;
  next_attempt_at: Date | null;
  created_at: Date;
  updated_at: Date;
  payload: Record<string, unknown>;
};

type WhatsAppAccount = {
  id: string;
  tenant_id: string;
  provider: string;
  phone_number: string;
  access_token: string | null;
  status: string;
};

type DeliverArgs = {
  limit?: number;
  tenantId?: string | null;
};

const GRAPH_VERSION = process.env.WHATSAPP_GRAPH_VERSION ?? "v19.0";
const DEFAULT_PROCESSING_RECOVERY_SECONDS = 300;

function getProcessingRecoverySeconds() {
  const configured = Number(process.env.WHATSAPP_OUTBOX_PROCESSING_RECOVERY_SECONDS ?? "300");
  if (!Number.isFinite(configured) || configured <= 0) {
    return DEFAULT_PROCESSING_RECOVERY_SECONDS;
  }
  return Math.floor(configured);
}

async function getActiveAccount(tenantId?: string | null) {
  const values = tenantId ? [tenantId] : [];
  const tenantClause = tenantId ? "AND tenant_id = $1" : "";
  const result = await db.query<WhatsAppAccount>(
    `SELECT id, tenant_id, provider, phone_number, access_token, status
     FROM whatsapp_accounts
     WHERE status = 'active'
       ${tenantClause}
     ORDER BY created_at DESC
     LIMIT 1`,
    values
  );
  return result.rows[0] ?? null;
}

async function lockPendingEvents(
  limit: number,
  processingRecoverySeconds: number,
  tenantId?: string | null
): Promise<WhatsAppEventRow[]> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const values: Array<number | string> = [limit, processingRecoverySeconds];
    const tenantClause = tenantId ? "AND e.tenant_id = $3" : "";
    if (tenantId) {
      values.push(tenantId);
    }
    const result = await client.query(
      `UPDATE whatsapp_events
       SET status = 'processing',
           last_error = NULL,
           updated_at = now()
       WHERE id IN (
         SELECT fair_q.id FROM (
           SELECT e.id,
                  ROW_NUMBER() OVER (PARTITION BY e.tenant_id ORDER BY e.created_at ASC) as rn
           FROM whatsapp_events e
           JOIN workspace_modules wm ON wm.tenant_id = e.tenant_id AND wm.workspace_key = 'primary'
           WHERE e.direction = 'outbound'
             ${tenantClause}
             AND (wm.modules->>'whatsapp')::boolean = true
             AND (
               (e.status = 'queued' AND e.next_attempt_at <= now())
               OR (
                 e.status = 'processing'
                 AND e.updated_at <= now() - make_interval(secs => $2::int)
               )
             )
         ) fair_q
         WHERE fair_q.rn <= GREATEST(1, $1::int / 2)
         ORDER BY fair_q.rn ASC, fair_q.id ASC
         LIMIT $1
         FOR UPDATE SKIP LOCKED
       )
       RETURNING id, tenant_id, payload, attempt_count`,
      values
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

async function markDelivered(
  eventId: string,
  tenantId: string,
  messageRecordId?: string | null,
  providerMessageId?: string | null
) {
  await db.query(
    `UPDATE whatsapp_events
     SET status = 'sent',
         updated_at = now()
     WHERE id = $1
       AND tenant_id = $2`,
    [eventId, tenantId]
  );

  const sentAt = new Date();
  await db.query(
    `INSERT INTO whatsapp_status_events (tenant_id, message_id, external_message_id, status, occurred_at, payload)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      tenantId,
      messageRecordId ?? null,
      providerMessageId ?? null,
      "sent",
      sentAt,
      {
        source: "outbox",
        status: "sent",
        providerMessageId: providerMessageId ?? null,
        eventId
      }
    ]
  );

  if (messageRecordId && providerMessageId) {
    await db.query(
      `UPDATE messages
       SET external_message_id = $1,
           wa_status = 'sent',
           wa_timestamp = $2
       WHERE id = $3
         AND tenant_id = $4`,
      [providerMessageId, sentAt, messageRecordId, tenantId]
    );
  } else if (messageRecordId) {
    await db.query(
      `UPDATE messages
       SET wa_status = 'sent',
           wa_timestamp = $2
       WHERE id = $1
         AND tenant_id = $3`,
      [messageRecordId, sentAt, tenantId]
    );
  }
}

async function markFailed(
  eventId: string,
  tenantId: string,
  attemptCount: number,
  errorMessage: string,
  messageRecordId?: string | null
) {
  const nextAttempt = new Date(Date.now() + Math.min(attemptCount, 5) * 60000);
  const status = attemptCount >= 5 ? "failed" : "queued";
  await db.query(
    `UPDATE whatsapp_events
     SET status = $1,
         attempt_count = $2,
         last_error = $3,
         next_attempt_at = $4,
         updated_at = now()
     WHERE id = $5
       AND tenant_id = $6`,
    [status, attemptCount, errorMessage.slice(0, 500), nextAttempt, eventId, tenantId]
  );

  if (messageRecordId) {
    await db.query(
      `INSERT INTO whatsapp_status_events (tenant_id, message_id, external_message_id, status, occurred_at, payload)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        tenantId,
        messageRecordId,
        null,
        "failed",
        new Date(),
        {
          source: "outbox",
          status: "failed",
          eventId,
          attemptCount,
          error: errorMessage.slice(0, 500)
        }
      ]
    );
    await db.query(
      `UPDATE messages
       SET wa_status = 'failed',
           wa_timestamp = now()
       WHERE id = $1
         AND tenant_id = $2`,
      [messageRecordId, tenantId]
    );
  }
}

function buildMetaPayload(payload: Record<string, unknown>, eventId: string) {
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
        biz_opaque_callback_data: eventId,
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
      biz_opaque_callback_data: eventId,
      text: { body: text }
    }
  };
}

function resolveMediaType(contentType: string | null, filename: string) {
  if (contentType?.startsWith("image/")) return "image";
  if (contentType?.startsWith("video/")) return "video";
  if (contentType?.startsWith("audio/")) return "audio";
  const lower = filename.toLowerCase();
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg") || lower.endsWith(".png")) return "image";
  if (lower.endsWith(".mp4") || lower.endsWith(".mov")) return "video";
  if (lower.endsWith(".mp3") || lower.endsWith(".wav")) return "audio";
  return "document";
}

async function uploadMetaMedia(
  accessToken: string,
  phoneNumberId: string,
  attachment: {
    r2Key: string;
    filename: string;
    contentType: string | null;
  },
  mediaType: string
) {
  const { buffer, contentType } = await getObjectBuffer(attachment.r2Key);
  const form = new FormData();
  const blob = new Blob([buffer], { type: contentType ?? "application/octet-stream" });
  form.append("file", blob, attachment.filename);
  form.append("type", mediaType);
  form.append("messaging_product", "whatsapp");

  const uploadUrl = `https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/media`;
  const response = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`
    },
    body: form
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(errorBody || `WhatsApp media upload failed (${response.status})`);
  }

  const data = (await response.json()) as { id?: string };
  return data.id ?? null;
}

async function sendMetaMessage(account: WhatsAppAccount, payload: Record<string, unknown>, eventId: string) {
  const accessToken = account.access_token ? decryptSecret(account.access_token) : "";
  if (!accessToken) {
    throw new Error("Missing WhatsApp access token");
  }
  if (!account.phone_number) {
    throw new Error("Missing WhatsApp phone number ID");
  }

  const attachments = Array.isArray(payload.attachments) ? payload.attachments : [];
  const template =
    typeof payload.template === "object" && payload.template
      ? (payload.template as Record<string, unknown>)
      : null;
  const caption =
    typeof payload.caption === "string" && payload.caption.trim()
      ? payload.caption.trim()
      : typeof payload.text === "string" && payload.text.trim()
        ? payload.text.trim()
        : null;

  if (attachments.length && template) {
    throw new Error("Templates cannot be combined with attachments");
  }

  if (attachments.length) {
    const attachment = attachments[0] as {
      r2Key?: string;
      filename?: string;
      contentType?: string | null;
    };
    if (!attachment?.r2Key || !attachment.filename) {
      throw new Error("Missing WhatsApp attachment payload");
    }
    const mediaType = resolveMediaType(attachment.contentType ?? null, attachment.filename);
    const mediaId = await uploadMetaMedia(
      accessToken,
      account.phone_number,
      {
        r2Key: attachment.r2Key,
        filename: attachment.filename,
        contentType: attachment.contentType ?? null
      },
      mediaType
    );
    if (!mediaId) {
      throw new Error("WhatsApp media upload returned no id");
    }
    const body = {
      messaging_product: "whatsapp",
      to: typeof payload.to === "string" ? payload.to : "",
      type: mediaType,
      biz_opaque_callback_data: eventId,
      [mediaType]: {
        id: mediaId,
        ...(caption && mediaType !== "audio" ? { caption } : {})
      }
    };
    if (!body.to) {
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
    const data = (await response.json()) as { messages?: Array<{ id?: string }> };
    const providerMessageId = data.messages?.[0]?.id ?? null;
    return { providerMessageId };
  }

  const { body, to } = buildMetaPayload(payload, eventId);
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

export async function deliverPendingWhatsAppEvents({ limit = 5, tenantId = null }: DeliverArgs = {}) {
  const pending = await lockPendingEvents(limit, getProcessingRecoverySeconds(), tenantId);
  if (!pending.length) {
    return { delivered: 0, skipped: 0 };
  }

  let delivered = 0;
  const accountByTenant = new Map<string, WhatsAppAccount | null>();
  for (const event of pending) {
    const payload = event.payload ?? {};
    const messageRecordId =
      typeof payload.messageRecordId === "string" ? payload.messageRecordId : null;
    try {
      let account = accountByTenant.get(event.tenant_id);
      if (account === undefined) {
        account = await getActiveAccount(event.tenant_id);
        accountByTenant.set(event.tenant_id, account);
      }
      if (!account) {
        await markFailed(event.id, event.tenant_id, event.attempt_count + 1, "No active WhatsApp account", messageRecordId);
        continue;
      }
      if (account.provider !== "meta") {
        throw new Error(`Provider ${account.provider} not supported yet`);
      }
      const { providerMessageId } = await sendMetaMessage(account, payload, event.id);
      await markDelivered(event.id, event.tenant_id, messageRecordId, providerMessageId);

      // Record FinOps usage: WhatsApp cost approx 5 cents (placeholder)
      await recordModuleUsageEvent({
        tenantId: event.tenant_id,
        moduleKey: "whatsapp",
        usageKind: "outbound_whatsapp",
        actorType: "system",
        quantity: 1,
        costCent: 85.0, 
        metadata: { eventId: event.id, messageId: messageRecordId }
      });

      delivered += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "WhatsApp delivery failed";
      const attempts = event.attempt_count + 1;
      await markFailed(event.id, event.tenant_id, attempts, message, messageRecordId);
    }
  }

  return { delivered, skipped: pending.length - delivered };
}

export async function listFailedWhatsAppOutboxEvents(limit = 50, tenantId?: string | null) {
  const normalizedLimit = Math.min(Math.max(limit, 1), 200);
  const values: Array<number | string> = [normalizedLimit];
  const tenantClause = tenantId ? "AND tenant_id = $2" : "";
  if (tenantId) {
    values.push(tenantId);
  }
  const result = await db.query<FailedWhatsAppOutboxEvent>(
    `SELECT
       id,
       tenant_id,
       status,
       attempt_count,
       last_error,
       next_attempt_at,
       created_at,
       updated_at,
       payload
     FROM whatsapp_events
     WHERE direction = 'outbound'
       AND status = 'failed'
       ${tenantClause}
     ORDER BY updated_at DESC
     LIMIT $1`,
    values
  );
  return result.rows;
}

type RetryFailedWhatsAppOutboxInput = {
  limit?: number;
  eventIds?: string[];
  tenantId?: string | null;
};

export async function retryFailedWhatsAppEvents(input: RetryFailedWhatsAppOutboxInput = {}) {
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
            `UPDATE whatsapp_events
             SET status = 'queued',
                 next_attempt_at = now(),
                 updated_at = now()
             WHERE direction = 'outbound'
               AND status = 'failed'
               AND id::text = ANY($1::text[])
               ${input.tenantId ? "AND tenant_id = $2" : ""}
             RETURNING id`,
            input.tenantId ? [eventIds, input.tenantId] : [eventIds]
          )
        : await client.query<{ id: string }>(
            `WITH failed AS (
               SELECT id
               FROM whatsapp_events
               WHERE direction = 'outbound'
                 AND status = 'failed'
                 ${input.tenantId ? "AND tenant_id = $2" : ""}
               ORDER BY updated_at ASC
               LIMIT $1
               FOR UPDATE SKIP LOCKED
             )
             UPDATE whatsapp_events evt
             SET status = 'queued',
                 next_attempt_at = now(),
                 updated_at = now()
             FROM failed
             WHERE evt.id = failed.id
             RETURNING evt.id`,
            input.tenantId ? [normalizedLimit, input.tenantId] : [normalizedLimit]
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
