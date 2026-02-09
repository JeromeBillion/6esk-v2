import { randomUUID } from "crypto";
import { z } from "zod";
import { inboundEmailSchema } from "@/server/email/schema";
import { normalizeAddressList, sanitizeFilename } from "@/server/email/normalize";
import { getOrCreateMailbox } from "@/server/email/mailbox";
import { db } from "@/server/db";
import { putObject } from "@/server/storage/r2";
import {
  addTagsToTicket,
  createTicket,
  inferTagsFromText,
  recordTicketEvent,
  reopenTicketIfNeeded,
  resolveTicketIdForInbound
} from "@/server/tickets";
import { buildAgentEvent } from "@/server/agents/events";
import { deliverPendingAgentEvents, enqueueAgentEvent } from "@/server/agents/outbox";
import { evaluateSpam } from "@/server/email/spam";

type InboundEmail = z.infer<typeof inboundEmailSchema>;

function getSupportAddress() {
  const explicit = process.env.SUPPORT_ADDRESS;
  if (explicit) {
    return explicit.toLowerCase();
  }
  const domain = process.env.RESEND_FROM_DOMAIN ?? "";
  return domain ? `support@${domain}`.toLowerCase() : "";
}

export async function storeInboundEmail(data: InboundEmail) {
  const toList = normalizeAddressList(data.to);
  const ccList = normalizeAddressList(data.cc ?? undefined);
  const bccList = normalizeAddressList(data.bcc ?? undefined);
  const fromEmail = normalizeAddressList(data.from)[0];

  if (!fromEmail || toList.length === 0) {
    throw new Error("Missing from/to addresses");
  }

  const supportAddress = getSupportAddress();
  const primaryRecipient = toList[0];
  const mailbox = await getOrCreateMailbox(primaryRecipient, supportAddress);

  const spamDecision = await evaluateSpam({
    fromEmail,
    subject: data.subject,
    text: data.text
  });

  if (data.messageId) {
    const existing = await db.query(
      "SELECT id, ticket_id FROM messages WHERE message_id = $1 AND mailbox_id = $2 LIMIT 1",
      [data.messageId, mailbox.id]
    );
    if ((existing.rowCount ?? 0) > 0) {
      return {
        status: "duplicate",
        messageId: existing.rows[0].id,
        ticketId: existing.rows[0].ticket_id ?? null,
        mailboxId: mailbox.id
      };
    }
  }

  let ticketId: string | null = null;
  let createdNewTicket = false;
  if (mailbox.type === "platform" && !spamDecision.isSpam) {
    const references = [data.inReplyTo, ...(data.references ?? [])].filter(
      (value): value is string => Boolean(value)
    );
    ticketId = await resolveTicketIdForInbound(references);
    if (!ticketId) {
      const inferredTags = data.tags?.length
        ? data.tags
        : inferTagsFromText({ subject: data.subject, text: data.text });
      const category =
        data.category?.toLowerCase().trim() ?? inferredTags[0]?.toLowerCase() ?? null;
      const metadata = (data.metadata as Record<string, unknown> | null) ?? null;

      ticketId = await createTicket({
        mailboxId: mailbox.id,
        requesterEmail: fromEmail,
        subject: data.subject,
        category,
        metadata
      });
      createdNewTicket = true;
      await recordTicketEvent({ ticketId, eventType: "ticket_created" });

      if (inferredTags.length) {
        await addTagsToTicket(ticketId, inferredTags);
        await recordTicketEvent({
          ticketId,
          eventType: "tags_assigned",
          data: { tags: inferredTags }
        });
      }
    } else {
      await reopenTicketIfNeeded(ticketId);
    }
    await recordTicketEvent({ ticketId, eventType: "message_received" });
  }

  const messageId = randomUUID();
  const receivedAt = data.date ? new Date(data.date) : new Date();
  const previewSource = data.text ?? "";
  const previewText = previewSource.replace(/\s+/g, " ").trim().slice(0, 200);

  await db.query(
    `INSERT INTO messages (
      id, mailbox_id, ticket_id, direction, message_id, thread_id, in_reply_to, references,
      from_email, to_emails, cc_emails, bcc_emails, subject, preview_text,
      received_at, is_read, is_spam, spam_reason
    ) VALUES (
      $1, $2, $3, 'inbound', $4, $5, $6, $7,
      $8, $9, $10, $11, $12, $13,
      $14, false, $15, $16
    )`,
    [
      messageId,
      mailbox.id,
      ticketId,
      data.messageId,
      data.references?.[0] ?? data.messageId ?? messageId,
      data.inReplyTo ?? null,
      data.references ?? null,
      fromEmail,
      toList,
      ccList,
      bccList,
      data.subject ?? null,
      previewText || null,
      receivedAt,
      spamDecision.isSpam,
      spamDecision.reason
    ]
  );

  const keyPrefix = `messages/${messageId}`;
  let rawKey: string | null = null;
  let textKey: string | null = null;
  let htmlKey: string | null = null;
  let sizeBytes = 0;

  if (data.raw) {
    const rawBuffer = Buffer.from(data.raw, "base64");
    rawKey = await putObject({
      key: `${keyPrefix}/raw.eml`,
      body: rawBuffer,
      contentType: "message/rfc822"
    });
    sizeBytes += rawBuffer.length;
  }

  if (data.text) {
    textKey = await putObject({
      key: `${keyPrefix}/body.txt`,
      body: data.text,
      contentType: "text/plain; charset=utf-8"
    });
    sizeBytes += Buffer.byteLength(data.text);
  }

  if (data.html) {
    htmlKey = await putObject({
      key: `${keyPrefix}/body.html`,
      body: data.html,
      contentType: "text/html; charset=utf-8"
    });
    sizeBytes += Buffer.byteLength(data.html);
  }

  if (data.attachments?.length) {
    for (const attachment of data.attachments) {
      if (!attachment.contentBase64) {
        continue;
      }
      const attachmentId = randomUUID();
      const safeFilename = sanitizeFilename(attachment.filename);
      const key = `${keyPrefix}/attachments/${attachmentId}-${safeFilename}`;
      const buffer = Buffer.from(attachment.contentBase64, "base64");

      await putObject({
        key,
        body: buffer,
        contentType: attachment.contentType ?? undefined
      });

      await db.query(
        `INSERT INTO attachments (id, message_id, filename, content_type, size_bytes, r2_key)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          attachmentId,
          messageId,
          attachment.filename,
          attachment.contentType ?? null,
          attachment.size ?? buffer.length,
          key
        ]
      );
    }
  }

  await db.query(
    `UPDATE messages
     SET r2_key_raw = $1, r2_key_text = $2, r2_key_html = $3, size_bytes = $4
     WHERE id = $5`,
    [rawKey, textKey, htmlKey, sizeBytes || null, messageId]
  );

  if (mailbox.type === "platform" && ticketId && !spamDecision.isSpam) {
    const threadId = data.references?.[0] ?? data.messageId ?? messageId;
    const messageEvent = buildAgentEvent({
      eventType: "ticket.message.created",
      ticketId,
      messageId,
      mailboxId: mailbox.id,
      excerpt: previewText,
      threadId
    });
    await enqueueAgentEvent({ eventType: "ticket.message.created", payload: messageEvent });

    if (createdNewTicket) {
      const ticketEvent = buildAgentEvent({
        eventType: "ticket.created",
        ticketId,
        mailboxId: mailbox.id,
        excerpt: previewText,
        threadId
      });
      await enqueueAgentEvent({ eventType: "ticket.created", payload: ticketEvent });
    }

    void deliverPendingAgentEvents().catch(() => {});
  }

  return { status: "stored", messageId, ticketId, mailboxId: mailbox.id };
}
