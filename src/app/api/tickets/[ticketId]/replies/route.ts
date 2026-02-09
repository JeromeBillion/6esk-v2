import { randomUUID } from "crypto";
import { z } from "zod";
import { getSessionUser } from "@/server/auth/session";
import { isLeadAdmin } from "@/server/auth/roles";
import { db } from "@/server/db";
import { putObject } from "@/server/storage/r2";
import { getTicketById, recordTicketEvent } from "@/server/tickets";

const replySchema = z.object({
  text: z.string().optional().nullable(),
  html: z.string().optional().nullable(),
  subject: z.string().optional().nullable()
});

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

export async function POST(
  request: Request,
  { params }: { params: Promise<{ ticketId: string }> }
) {
  const user = await getSessionUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { ticketId } = await params;
  const ticket = await getTicketById(ticketId);
  if (!ticket) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const isAdmin = isLeadAdmin(user);
  if (!isAdmin && ticket.assigned_user_id !== user.id) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch (error) {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = replySchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json({ error: "Invalid payload" }, { status: 400 });
  }

  const { text, html, subject } = parsed.data;
  if (!text && !html) {
    return Response.json({ error: "Reply body required" }, { status: 400 });
  }

  const from = getSupportAddress();
  if (!from) {
    return Response.json({ error: "Support address not configured" }, { status: 500 });
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
    return Response.json(
      { error: "Resend request failed", details: errorBody },
      { status: 502 }
    );
  }

  const resendData = (await resendResponse.json()) as ResendResponse;
  const messageId = randomUUID();
  const sentAt = new Date();

  await db.query(
    `INSERT INTO messages (
      id, mailbox_id, ticket_id, direction, message_id, thread_id, from_email,
      to_emails, subject, preview_text, sent_at, is_read
    ) VALUES (
      $1, $2, $3, 'outbound', $4, $5, $6,
      $7, $8, $9, $10, true
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
      sentAt
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
    eventType: "reply_sent",
    actorUserId: user.id
  });

  if (ticket.status === "new" || ticket.status === "pending") {
    await db.query("UPDATE tickets SET status = 'open', updated_at = now() WHERE id = $1", [
      ticketId
    ]);
    await recordTicketEvent({
      ticketId,
      eventType: "status_updated",
      actorUserId: user.id,
      data: { from: ticket.status, to: "open" }
    });
  }

  return Response.json({ status: "sent", id: messageId });
}
