import { randomUUID } from "crypto";
import { db } from "@/server/db";
import { getOrCreateMailbox } from "@/server/email/mailbox";
import { putObject } from "@/server/storage/r2";
import {
  addTagsToTicket,
  createTicket,
  inferTagsFromText,
  recordTicketEvent,
  reopenTicketIfNeeded
} from "@/server/tickets";
import { buildAgentEvent } from "@/server/agents/events";
import { deliverPendingAgentEvents, enqueueAgentEvent } from "@/server/agents/outbox";

export type NormalizedWhatsAppMessage = {
  provider: string;
  messageId?: string | null;
  conversationId?: string | null;
  from: string;
  to?: string | null;
  text?: string | null;
  timestamp?: string | number | null;
  contactName?: string | null;
};

function getSupportAddress() {
  const explicit = process.env.SUPPORT_ADDRESS;
  if (explicit) {
    return explicit.toLowerCase();
  }
  const domain = process.env.RESEND_FROM_DOMAIN ?? "";
  return domain ? `support@${domain}`.toLowerCase() : "";
}

function normalizeContact(value: string) {
  return value.replace(/\s+/g, "").trim();
}

function formatRequester(contact: string) {
  if (!contact) return "whatsapp:unknown";
  return contact.startsWith("whatsapp:") ? contact : `whatsapp:${contact}`;
}

function parseTimestamp(value?: string | number | null) {
  if (!value) return new Date();
  if (typeof value === "number") {
    return new Date(value < 1e12 ? value * 1000 : value);
  }
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) {
    const numeric = Number(trimmed);
    return new Date(numeric < 1e12 ? numeric * 1000 : numeric);
  }
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

async function resolveWhatsAppTicketId(conversationId: string) {
  const result = await db.query<{ ticket_id: string }>(
    `SELECT ticket_id
     FROM messages
     WHERE channel = 'whatsapp'
       AND conversation_id = $1
       AND ticket_id IS NOT NULL
     ORDER BY created_at DESC
     LIMIT 1`,
    [conversationId]
  );
  return result.rows[0]?.ticket_id ?? null;
}

export async function storeInboundWhatsApp(message: NormalizedWhatsAppMessage) {
  const supportAddress = getSupportAddress();
  if (!supportAddress) {
    throw new Error("Support address not configured");
  }

  const from = normalizeContact(message.from);
  if (!from) {
    throw new Error("Missing WhatsApp sender");
  }

  if (message.messageId) {
    const existing = await db.query(
      `SELECT id, ticket_id
       FROM messages
       WHERE channel = 'whatsapp'
         AND external_message_id = $1
       LIMIT 1`,
      [message.messageId]
    );
    if ((existing.rowCount ?? 0) > 0) {
      return {
        status: "duplicate",
        messageId: existing.rows[0].id,
        ticketId: existing.rows[0].ticket_id ?? null
      };
    }
  }

  const mailbox = await getOrCreateMailbox(supportAddress, supportAddress);
  const conversationId = message.conversationId ?? from;

  let ticketId: string | null = await resolveWhatsAppTicketId(conversationId);
  let createdNewTicket = false;

  const previewSource = message.text ?? "";
  const previewText = previewSource.replace(/\s+/g, " ").trim().slice(0, 200);

  if (!ticketId) {
    const inferredTags = inferTagsFromText({ subject: null, text: message.text ?? null });
    const subject = previewText ? `WhatsApp: ${previewText.slice(0, 60)}` : `WhatsApp from ${from}`;
    const category = inferredTags[0]?.toLowerCase() ?? null;
    const metadata = {
      channel: "whatsapp",
      wa_contact: from,
      provider: message.provider ?? "meta",
      contact_name: message.contactName ?? null
    };

    ticketId = await createTicket({
      mailboxId: mailbox.id,
      requesterEmail: formatRequester(from),
      subject,
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

  const messageId = randomUUID();
  const receivedAt = parseTimestamp(message.timestamp);

  await db.query(
    `INSERT INTO messages (
      id, mailbox_id, ticket_id, direction, channel, message_id, thread_id,
      external_message_id, conversation_id, wa_contact, wa_status, wa_timestamp, provider,
      from_email, to_emails, subject, preview_text, received_at, is_read
    ) VALUES (
      $1, $2, $3, 'inbound', 'whatsapp', $4, $5,
      $6, $7, $8, $9, $10, $11,
      $12, $13, $14, $15, $16, false
    )`,
    [
      messageId,
      mailbox.id,
      ticketId,
      message.messageId ?? null,
      conversationId,
      message.messageId ?? null,
      conversationId,
      from,
      "received",
      receivedAt,
      message.provider ?? "meta",
      from,
      [supportAddress],
      previewText ? `WhatsApp: ${previewText.slice(0, 80)}` : null,
      previewText || null,
      receivedAt
    ]
  );

  let textKey: string | null = null;
  let sizeBytes = 0;

  if (message.text) {
    textKey = await putObject({
      key: `messages/${messageId}/body.txt`,
      body: message.text,
      contentType: "text/plain; charset=utf-8"
    });
    sizeBytes += Buffer.byteLength(message.text);
  }

  if (textKey) {
    await db.query(
      `UPDATE messages
       SET r2_key_text = $1, size_bytes = $2
       WHERE id = $3`,
      [textKey, sizeBytes || null, messageId]
    );
  }

  if (ticketId) {
    const messageEvent = buildAgentEvent({
      eventType: "ticket.message.created",
      ticketId,
      messageId,
      mailboxId: mailbox.id,
      excerpt: previewText,
      threadId: conversationId
    });
    await enqueueAgentEvent({ eventType: "ticket.message.created", payload: messageEvent });

    if (createdNewTicket) {
      const ticketEvent = buildAgentEvent({
        eventType: "ticket.created",
        ticketId,
        mailboxId: mailbox.id,
        excerpt: previewText,
        threadId: conversationId
      });
      await enqueueAgentEvent({ eventType: "ticket.created", payload: ticketEvent });
    }

    void deliverPendingAgentEvents().catch(() => {});
  }

  return { status: "stored", messageId, ticketId, mailboxId: mailbox.id };
}
