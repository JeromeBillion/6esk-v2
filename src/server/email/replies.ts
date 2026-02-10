import { randomUUID } from "crypto";
import { db } from "@/server/db";
import { putObject } from "@/server/storage/r2";
import { getTicketById, recordTicketEvent } from "@/server/tickets";
import { queueWhatsAppSend } from "@/server/whatsapp/send";
import { getWhatsAppWindowStatus } from "@/server/whatsapp/window";

type SendReplyArgs = {
  ticketId: string;
  text?: string | null;
  html?: string | null;
  subject?: string | null;
  template?: Record<string, unknown> | null;
  actorUserId?: string | null;
  origin?: "human" | "ai";
  aiMeta?: Record<string, unknown> | null;
};

function getSupportAddress() {
  const explicit = process.env.SUPPORT_ADDRESS;
  if (explicit) {
    return explicit.toLowerCase();
  }
  const domain = process.env.RESEND_FROM_DOMAIN ?? "";
  return domain ? `support@${domain}`.toLowerCase() : "";
}

type ResendResponse = {
  id?: string;
  messageId?: string;
};

export async function sendTicketReply({
  ticketId,
  text,
  html,
  subject,
  template,
  actorUserId,
  origin = "human",
  aiMeta
}: SendReplyArgs) {
  const ticket = await getTicketById(ticketId);
  if (!ticket) {
    throw new Error("Ticket not found");
  }

  const isWhatsAppTicket =
    ticket.requester_email?.startsWith("whatsapp:") ||
    (ticket.metadata && (ticket.metadata as Record<string, unknown>).channel === "whatsapp");

  if (!text && !html) {
    throw new Error("Reply body required");
  }

  if (isWhatsAppTicket) {
    const contact = ticket.requester_email?.replace(/^whatsapp:/, "") ?? "";
    const body =
      text ??
      (html
        ? html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
        : "");
    const cleanBody = body.trim() ? body : null;
    const windowStatus = await getWhatsAppWindowStatus(ticketId);
    if (!windowStatus.isOpen && !template) {
      throw new Error("WhatsApp 24h window closed. Template required.");
    }
    if (!cleanBody && !template) {
      throw new Error("Reply body required");
    }

    const result = await queueWhatsAppSend({
      ticketId,
      to: contact,
      text: cleanBody,
      template: template ?? null,
      actorUserId: actorUserId ?? null,
      origin,
      aiMeta: aiMeta ?? null
    });
    return { messageId: result.messageId ?? null };
  }

  const from = getSupportAddress();
  if (!from) {
    throw new Error("Support address not configured");
  }

  const finalSubject = subject ?? (ticket.subject ? `Re: ${ticket.subject}` : "Re: Support request");

  const resendPayload = {
    from,
    to: [ticket.requester_email],
    subject: finalSubject,
    html: html ?? undefined,
    text: text ?? undefined
  };

  const resendResponse = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY ?? ""}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(resendPayload)
  });

  if (!resendResponse.ok) {
    const errorBody = await resendResponse.text();
    throw new Error(errorBody || "Resend request failed");
  }

  const resendData = (await resendResponse.json()) as ResendResponse;
  const messageId = randomUUID();
  const sentAt = new Date();

  await db.query(
    `INSERT INTO messages (
      id, mailbox_id, ticket_id, direction, message_id, thread_id, from_email,
      to_emails, subject, preview_text, sent_at, is_read, origin, ai_meta
    ) VALUES (
      $1, $2, $3, 'outbound', $4, $5, $6,
      $7, $8, $9, $10, true, $11, $12
    )`,
    [
      messageId,
      ticket.mailbox_id,
      ticketId,
      resendData.messageId ?? resendData.id ?? null,
      resendData.messageId ?? resendData.id ?? messageId,
      from,
      [ticket.requester_email],
      finalSubject,
      (text ?? "").replace(/\s+/g, " ").trim().slice(0, 200) || null,
      sentAt,
      origin,
      aiMeta ?? null
    ]
  );

  const keyPrefix = `messages/${messageId}`;
  let textKey: string | null = null;
  let htmlKey: string | null = null;
  let sizeBytes = 0;

  if (text) {
    textKey = await putObject({
      key: `${keyPrefix}/body.txt`,
      body: text,
      contentType: "text/plain; charset=utf-8"
    });
    sizeBytes += Buffer.byteLength(text);
  }

  if (html) {
    htmlKey = await putObject({
      key: `${keyPrefix}/body.html`,
      body: html,
      contentType: "text/html; charset=utf-8"
    });
    sizeBytes += Buffer.byteLength(html);
  }

  await db.query(
    `UPDATE messages
     SET r2_key_text = $1, r2_key_html = $2, size_bytes = $3
     WHERE id = $4`,
    [textKey, htmlKey, sizeBytes || null, messageId]
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

  return { messageId };
}
