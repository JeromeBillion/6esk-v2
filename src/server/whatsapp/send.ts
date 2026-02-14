import { randomUUID } from "crypto";
import { db } from "@/server/db";
import { sanitizeFilename } from "@/server/email/normalize";
import { putObject } from "@/server/storage/r2";
import { getTicketById, recordTicketEvent } from "@/server/tickets";

type SendWhatsAppArgs = {
  ticketId?: string | null;
  to: string;
  text?: string | null;
  attachments?: Array<{
    filename: string;
    contentType?: string | null;
    size?: number | null;
    contentBase64: string;
  }> | null;
  template?: Record<string, unknown> | null;
  actorUserId?: string | null;
  origin?: "human" | "ai";
  aiMeta?: Record<string, unknown> | null;
  messageMetadata?: Record<string, unknown> | null;
};

function formatContact(contact: string) {
  return contact.replace(/\s+/g, "").trim();
}

async function getActiveAccount() {
  const result = await db.query(
    `SELECT id, provider, phone_number, status
     FROM whatsapp_accounts
     WHERE status = 'active'
     ORDER BY created_at DESC
     LIMIT 1`
  );
  return result.rows[0] ?? null;
}

export async function queueWhatsAppSend({
  ticketId,
  to,
  text,
  attachments,
  template,
  actorUserId,
  origin = "human",
  aiMeta,
  messageMetadata
}: SendWhatsAppArgs) {
  const attachmentList = attachments ?? [];
  if (attachmentList.length > 1) {
    throw new Error("WhatsApp supports one attachment per message.");
  }
  if (attachmentList.length && template) {
    throw new Error("Templates cannot be combined with attachments.");
  }

  const contact = formatContact(to);
  if (!contact) {
    throw new Error("Missing WhatsApp recipient");
  }

  const account = await getActiveAccount();
  if (!account) {
    throw new Error("WhatsApp account not configured");
  }

  let messageRecordId: string | null = null;
  let ticketMailboxId: string | null = null;
  const payloadAttachments: Array<{
    filename: string;
    contentType: string | null;
    size: number | null;
    r2Key: string;
  }> = [];

  if (ticketId) {
    const ticket = await getTicketById(ticketId);
    if (ticket) {
      ticketMailboxId = ticket.mailbox_id ?? null;
      const from = account.phone_number ? `whatsapp:${account.phone_number}` : "whatsapp:unknown";
      const messageId = randomUUID();
      const sentAt = new Date();
      const bodyText =
        text ??
        (template
          ? `Template: ${template.name ?? "unknown"} (${template.language ?? "default"})`
          : "");
      const attachmentHint =
        attachmentList.length > 0
          ? attachmentList[0]?.filename
            ? `Attachment: ${attachmentList[0].filename}`
            : "Attachment"
          : "";
      const previewSource = bodyText || attachmentHint;
      const previewText = previewSource.replace(/\s+/g, " ").trim().slice(0, 200);

      await db.query(
        `INSERT INTO messages (
          id, mailbox_id, ticket_id, direction, channel, message_id, thread_id,
          external_message_id, conversation_id, wa_contact, wa_status, wa_timestamp, provider,
          from_email, to_emails, subject, preview_text, sent_at, is_read, origin, ai_meta, metadata
        ) VALUES (
          $1, $2, $3, 'outbound', 'whatsapp', $4, $5,
          $6, $7, $8, $9, $10, $11,
          $12, $13, $14, $15, $16, true, $17, $18, $19
        )`,
        [
          messageId,
          ticket.mailbox_id ?? null,
          ticketId,
          null,
          contact,
          null,
          contact,
          contact,
          "queued",
          sentAt,
          account.provider,
          from,
          [formatContact(contact)],
          "WhatsApp reply",
          previewText || null,
          sentAt,
          origin,
          aiMeta ?? null,
          messageMetadata ?? null
        ]
      );

      const textKey = await putObject({
        key: `messages/${messageId}/body.txt`,
        body: bodyText || (attachmentHint ? "[whatsapp attachment]" : "[whatsapp template]"),
        contentType: "text/plain; charset=utf-8"
      });

      let sizeBytes = Buffer.byteLength(bodyText || "");

      if (attachmentList.length) {
        for (const attachment of attachmentList) {
          if (!attachment.contentBase64) continue;
          const attachmentId = randomUUID();
          const safeFilename = sanitizeFilename(attachment.filename);
          const key = `messages/${messageId}/attachments/${attachmentId}-${safeFilename}`;
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
          payloadAttachments.push({
            filename: attachment.filename,
            contentType: attachment.contentType ?? null,
            size: attachment.size ?? buffer.length,
            r2Key: key
          });
          sizeBytes += attachment.size ?? buffer.length;
        }
      }

      await db.query(
        `UPDATE messages
         SET r2_key_text = $1, size_bytes = $2
         WHERE id = $3`,
        [textKey, sizeBytes || null, messageId]
      );

      await recordTicketEvent({
        ticketId,
        eventType: origin === "ai" ? "ai_reply_sent" : "reply_sent",
        actorUserId: actorUserId ?? null,
        data: origin === "ai" ? { ai: true } : null
      });

      await db.query(
        `INSERT INTO whatsapp_status_events (message_id, external_message_id, status, occurred_at, payload)
         VALUES ($1, $2, $3, $4, $5)`,
        [messageId, null, "queued", sentAt, { source: "outbox", status: "queued" }]
      );

      if (ticket.status === "new" || ticket.status === "pending") {
        await db.query("UPDATE tickets SET status = 'open', updated_at = now() WHERE id = $1", [
          ticketId
        ]);
        await recordTicketEvent({
          ticketId,
          eventType: "status_updated",
          actorUserId: actorUserId ?? null,
          data: { from: ticket.status, to: "open" }
        });
      }

      messageRecordId = messageId;
    }
  }

  const attachmentPayload = payloadAttachments.length ? payloadAttachments : null;

  const payload = {
    to: contact,
    text: text ?? null,
    caption: attachments?.length ? text ?? null : null,
    attachments: attachmentPayload,
    template: template ?? null,
    ticketId: ticketId ?? null,
    messageRecordId,
    mailboxId: ticketMailboxId,
    provider: account.provider
  };

  await db.query(
    `INSERT INTO whatsapp_events (direction, payload, status)
     VALUES ($1, $2, $3)`,
    ["outbound", payload, "queued"]
  );

  return { status: "queued", messageId: messageRecordId ?? undefined };
}
