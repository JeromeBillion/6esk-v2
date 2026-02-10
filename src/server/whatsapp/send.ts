import { randomUUID } from "crypto";
import { db } from "@/server/db";
import { putObject } from "@/server/storage/r2";
import { getTicketById, recordTicketEvent } from "@/server/tickets";

type SendWhatsAppArgs = {
  ticketId?: string | null;
  to: string;
  text: string;
  template?: Record<string, unknown> | null;
  actorUserId?: string | null;
  origin?: "human" | "ai";
  aiMeta?: Record<string, unknown> | null;
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
  template,
  actorUserId,
  origin = "human",
  aiMeta
}: SendWhatsAppArgs) {
  const contact = formatContact(to);
  if (!contact) {
    throw new Error("Missing WhatsApp recipient");
  }

  const account = await getActiveAccount();
  if (!account) {
    throw new Error("WhatsApp account not configured");
  }

  const payload = {
    to: contact,
    text,
    template: template ?? null,
    ticketId: ticketId ?? null,
    provider: account.provider
  };

  await db.query(
    `INSERT INTO whatsapp_events (direction, payload, status)
     VALUES ($1, $2, $3)`,
    ["outbound", payload, "queued"]
  );

  if (!ticketId) {
    return { status: "queued" };
  }

  const ticket = await getTicketById(ticketId);
  if (!ticket) {
    return { status: "queued" };
  }

  const from = account.phone_number ? `whatsapp:${account.phone_number}` : "whatsapp:unknown";
  const messageId = randomUUID();
  const sentAt = new Date();
  const previewText = text.replace(/\s+/g, " ").trim().slice(0, 200);

  await db.query(
    `INSERT INTO messages (
      id, mailbox_id, ticket_id, direction, channel, message_id, thread_id,
      external_message_id, conversation_id, wa_contact, wa_status, wa_timestamp, provider,
      from_email, to_emails, subject, preview_text, sent_at, is_read, origin, ai_meta
    ) VALUES (
      $1, $2, $3, 'outbound', 'whatsapp', $4, $5,
      $6, $7, $8, $9, $10, $11,
      $12, $13, $14, $15, $16, true, $17, $18
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
      aiMeta ?? null
    ]
  );

  const textKey = await putObject({
    key: `messages/${messageId}/body.txt`,
    body: text,
    contentType: "text/plain; charset=utf-8"
  });

  await db.query(
    `UPDATE messages
     SET r2_key_text = $1, size_bytes = $2
     WHERE id = $3`,
    [textKey, Buffer.byteLength(text), messageId]
  );

  await recordTicketEvent({
    ticketId,
    eventType: origin === "ai" ? "ai_reply_sent" : "reply_sent",
    actorUserId: actorUserId ?? null,
    data: origin === "ai" ? { ai: true } : null
  });

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

  return { status: "queued", messageId };
}
