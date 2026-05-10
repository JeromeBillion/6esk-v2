import { db } from "@/server/db";
import { getObjectBuffer } from "@/server/storage/r2";
import { recordModuleUsageEvent } from "@/server/module-metering";

type NumericLike = number | string | null | undefined;

type EmailOutboxEventRow = {
  id: string;
  tenant_id: string;
  payload: Record<string, unknown>;
  attempt_count: number;
};

type EmailOutboxSummaryRow = {
  queued: NumericLike;
  due_now: NumericLike;
  processing: NumericLike;
  failed: NumericLike;
  sent_total: NumericLike;
  sent_24h: NumericLike;
  next_attempt_at: Date | null;
  last_sent_at: Date | null;
  last_failed_at: Date | null;
};

type OutboxMessageRow = {
  id: string;
  r2_key_text: string | null;
  r2_key_html: string | null;
  message_id: string | null;
  in_reply_to: string | null;
  reference_ids: string[] | null;
};

type OutboxAttachmentRow = {
  filename: string;
  content_type: string | null;
  r2_key: string;
};

type DeliverArgs = {
  limit?: number;
};

const DEFAULT_PROCESSING_RECOVERY_SECONDS = 300;

function getProcessingRecoverySeconds() {
  const configured = Number(process.env.EMAIL_OUTBOX_PROCESSING_RECOVERY_SECONDS ?? "300");
  if (!Number.isFinite(configured) || configured <= 0) {
    return DEFAULT_PROCESSING_RECOVERY_SECONDS;
  }
  return Math.floor(configured);
}

function toNumber(value: NumericLike) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toIso(value: Date | null | undefined) {
  return value ? value.toISOString() : null;
}

async function lockPendingEvents(limit: number, processingRecoverySeconds: number) {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<EmailOutboxEventRow>(
      `UPDATE email_outbox_events
       SET status = 'processing',
           last_error = NULL,
           updated_at = now()
       WHERE id IN (
         SELECT fair_q.id FROM (
           SELECT e.id,
                  ROW_NUMBER() OVER (PARTITION BY e.tenant_id ORDER BY e.created_at ASC) as rn
           FROM email_outbox_events e
           JOIN workspace_modules wm ON wm.tenant_id = e.tenant_id AND wm.workspace_key = 'primary'
           WHERE e.direction = 'outbound'
             AND (wm.modules->>'email')::boolean = true
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
      [limit, processingRecoverySeconds]
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

async function loadOutboxMessage(messageId: string) {
  const messageResult = await db.query<OutboxMessageRow>(
    `SELECT id, r2_key_text, r2_key_html, message_id, in_reply_to, reference_ids
     FROM messages
     WHERE id = $1
     LIMIT 1`,
    [messageId]
  );
  const message = messageResult.rows[0];
  if (!message) {
    throw new Error("Queued email message not found");
  }

  const attachmentResult = await db.query<OutboxAttachmentRow>(
    `SELECT filename, content_type, r2_key
     FROM attachments
     WHERE message_id = $1
     ORDER BY created_at ASC`,
    [messageId]
  );

  const text = message.r2_key_text ? (await getObjectBuffer(message.r2_key_text)).buffer.toString("utf-8") : null;
  const html = message.r2_key_html ? (await getObjectBuffer(message.r2_key_html)).buffer.toString("utf-8") : null;

  const attachments = await Promise.all(
    attachmentResult.rows.map(async (attachment) => {
      const { buffer } = await getObjectBuffer(attachment.r2_key);
      return {
        filename: attachment.filename,
        contentType: attachment.content_type ?? undefined,
        contentBase64: buffer.toString("base64")
      };
    })
  );

  return {
    message,
    text,
    html,
    attachments
  };
}

async function sendQueuedEmail(eventId: string, payload: Record<string, unknown>) {
  const messageRecordId =
    typeof payload.messageRecordId === "string" ? payload.messageRecordId : null;
  if (!messageRecordId) {
    throw new Error("Email outbox payload missing messageRecordId");
  }

  const { message, text, html, attachments } = await loadOutboxMessage(messageRecordId);
  const from = typeof payload.from === "string" ? payload.from : "";
  const to = Array.isArray(payload.to) ? payload.to.filter((value): value is string => typeof value === "string") : [];
  const cc = Array.isArray(payload.cc) ? payload.cc.filter((value): value is string => typeof value === "string") : [];
  const bcc = Array.isArray(payload.bcc) ? payload.bcc.filter((value): value is string => typeof value === "string") : [];
  const subject = typeof payload.subject === "string" ? payload.subject : "";
  const replyTo = typeof payload.replyTo === "string" ? payload.replyTo : undefined;

  if (!from || !to.length || !subject) {
    throw new Error("Queued email payload is incomplete");
  }

  const connection = await import("@/server/oauth/connections").then(m => m.getActiveConnectionForMailbox(from));

  let providerMessageId: string | null = null;
  let finalProvider = "resend";

  if (connection?.provider === "google" || connection?.provider === "microsoft" || connection?.provider === "zoho") {
    const { getConnectionTokens } = await import("@/server/oauth/connections");
    const { decryptToken } = await import("@/server/oauth/crypto");

    const tokens = await getConnectionTokens(connection.id);
    if (!tokens) throw new Error("Connection tokens missing");

    const combinedStr = decryptToken(tokens.accessTokenEnc, tokens.tokenIv);
    const { accessToken } = JSON.parse(combinedStr);

    const emailPayload = {
      to,
      cc: cc.length ? cc : undefined,
      bcc: bcc.length ? bcc : undefined,
      subject,
      html: html ?? undefined,
      text: text ?? undefined,
      replyTo,
      inReplyTo: message.in_reply_to ?? undefined,
      references: message.reference_ids?.length ? message.reference_ids : undefined
    };

    if (connection.provider === "google") {
      const { sendGmailMessage } = await import("@/server/oauth/providers/google");
      const result = await sendGmailMessage(accessToken, emailPayload);
      providerMessageId = result.messageId;
      finalProvider = "google";
    } else if (connection.provider === "microsoft") {
      const { sendOutlookMessage } = await import("@/server/oauth/providers/microsoft");
      const result = await sendOutlookMessage(accessToken, emailPayload);
      providerMessageId = result.messageId;
      finalProvider = "microsoft";
    } else if (connection.provider === "zoho") {
      const { sendZohoMessage } = await import("@/server/oauth/providers/zoho");
      // Zoho needs accountId which we stored in provider_account_id
      const result = await sendZohoMessage(accessToken, connection.provider_account_id!, emailPayload);
      providerMessageId = result.messageId;
      finalProvider = "zoho";
    }
  } else {
    // Fallback to Resend
    const resendPayload = {
      from,
      to,
      cc: cc.length ? cc : undefined,
      bcc: bcc.length ? bcc : undefined,
      subject,
      html: html ?? undefined,
      text: text ?? undefined,
      reply_to: replyTo,
      headers: {
        ...(message.message_id ? { "Message-ID": message.message_id } : {}),
        ...(message.in_reply_to ? { "In-Reply-To": message.in_reply_to } : {}),
        ...(message.reference_ids?.length ? { References: message.reference_ids.join(" ") } : {})
      },
      attachments: attachments.length
        ? attachments.map((attachment) => ({
            filename: attachment.filename,
            content: attachment.contentBase64,
            contentType: attachment.contentType
          }))
        : undefined
    };

    const resendResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY ?? ""}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `email-outbox:${eventId}`
      },
      body: JSON.stringify(resendPayload)
    });

    if (!resendResponse.ok) {
      const errorBody = await resendResponse.text();
      throw new Error(errorBody || `Resend request failed for outbox event ${eventId}`);
    }

    const resendData = (await resendResponse.json()) as { id?: string; messageId?: string };
    providerMessageId = resendData.id ?? resendData.messageId ?? null;
  }

  return {
    messageRecordId,
    providerMessageId,
    provider: finalProvider
  };
}

async function markDelivered(eventId: string, messageRecordId: string | null, providerMessageId: string | null) {
  await db.query(
    `UPDATE email_outbox_events
     SET status = 'sent',
         updated_at = now()
     WHERE id = $1`,
    [eventId]
  );

  if (!messageRecordId) {
    return;
  }

  await db.query(
    `UPDATE messages
     SET external_message_id = $1,
         provider = 'resend',
         sent_at = now(),
         metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
           'mail_state', 'sent',
           'sent_via_outbox_at', now()::text,
           'last_send_error', NULL
         )
     WHERE id = $2`,
    [providerMessageId, messageRecordId]
  );
}

async function markFailed(eventId: string, attemptCount: number, errorMessage: string, messageRecordId: string | null) {
  const nextAttempt = new Date(Date.now() + Math.min(attemptCount, 5) * 60000);
  const status = attemptCount >= 5 ? "failed" : "queued";

  await db.query(
    `UPDATE email_outbox_events
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
       SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
         'mail_state', $1,
         'last_send_error', $2
       )
       WHERE id = $3`,
      [status === "failed" ? "failed" : "queued", errorMessage.slice(0, 500), messageRecordId]
    );
  }
}

export async function enqueueEmailOutboxEvent(payload: Record<string, unknown>, tenantId?: string) {
  const finalTenantId = tenantId || "00000000-0000-0000-0000-000000000001";
  const result = await db.query<{ id: string }>(
    `INSERT INTO email_outbox_events (tenant_id, direction, payload, status)
     VALUES ($1, 'outbound', $2::jsonb, 'queued')
     RETURNING id`,
    [finalTenantId, payload]
  );
  return result.rows[0]?.id ?? null;
}

export async function deliverPendingEmailOutboxEvents({ limit = 5 }: DeliverArgs = {}) {
  const pending = await lockPendingEvents(limit, getProcessingRecoverySeconds());
  if (!pending.length) {
    return { delivered: 0, skipped: 0 };
  }

  let delivered = 0;
  for (const event of pending) {
    const payload = event.payload ?? {};
    const messageRecordId =
      typeof payload.messageRecordId === "string" ? payload.messageRecordId : null;
    try {
      if (messageRecordId) {
        await db.query(
          `UPDATE messages
           SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
             'mail_state', 'processing',
             'last_send_error', NULL
           )
           WHERE id = $1`,
          [messageRecordId]
        );
      }

      const { providerMessageId } = await sendQueuedEmail(event.id, payload);
      await markDelivered(event.id, messageRecordId, providerMessageId);

      // Record FinOps usage: Resend cost is $1 per 1000 = $0.001 (0.1 cents)
      await recordModuleUsageEvent({
        tenantId: event.tenant_id,
        moduleKey: "email",
        usageKind: "outbound_email",
        actorType: "system",
        quantity: 1,
        costCent: 1.7, 
        metadata: { eventId: event.id, messageId: messageRecordId }
      });

      delivered += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Email outbox delivery failed";
      await markFailed(event.id, event.attempt_count + 1, message, messageRecordId);
    }
  }

  return { delivered, skipped: pending.length - delivered };
}

export async function getEmailOutboxMetrics() {
  const summaryResult = await db.query<EmailOutboxSummaryRow>(
    `SELECT
       COUNT(*) FILTER (WHERE status = 'queued')::int AS queued,
       COUNT(*) FILTER (WHERE status = 'queued' AND next_attempt_at <= now())::int AS due_now,
       COUNT(*) FILTER (WHERE status = 'processing')::int AS processing,
       COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
       COUNT(*) FILTER (WHERE status = 'sent')::int AS sent_total,
       COUNT(*) FILTER (
         WHERE status = 'sent'
           AND updated_at >= now() - interval '24 hours'
       )::int AS sent_24h,
       MIN(next_attempt_at) FILTER (WHERE status = 'queued') AS next_attempt_at,
       MAX(updated_at) FILTER (WHERE status = 'sent') AS last_sent_at,
       MAX(updated_at) FILTER (WHERE status = 'failed') AS last_failed_at
     FROM email_outbox_events
     WHERE direction = 'outbound'`
  );

  const summary = summaryResult.rows[0] ?? {
    queued: 0,
    due_now: 0,
    processing: 0,
    failed: 0,
    sent_total: 0,
    sent_24h: 0,
    next_attempt_at: null,
    last_sent_at: null,
    last_failed_at: null
  };

  return {
    queue: {
      queued: toNumber(summary.queued),
      dueNow: toNumber(summary.due_now),
      processing: toNumber(summary.processing),
      failed: toNumber(summary.failed),
      sentTotal: toNumber(summary.sent_total),
      sent24h: toNumber(summary.sent_24h),
      nextAttemptAt: toIso(summary.next_attempt_at),
      lastSentAt: toIso(summary.last_sent_at),
      lastFailedAt: toIso(summary.last_failed_at)
    }
  };
}
