import { z } from "zod";
import { randomUUID } from "crypto";
import { db } from "@/server/db";
import { getOrCreateMailbox } from "@/server/email/mailbox";
import { normalizeAddressList } from "@/server/email/normalize";
import { putObject } from "@/server/storage/r2";
import {
  addTagsToTicket,
  createTicket,
  inferTagsFromText,
  recordTicketEvent
} from "@/server/tickets";
import { buildAgentEvent } from "@/server/agents/events";
import { deliverPendingAgentEvents, enqueueAgentEvent } from "@/server/agents/outbox";

const portalSchema = z.object({
  from: z.string().email(),
  subject: z.string().min(1),
  description: z.string().min(1),
  category: z.string().optional().nullable(),
  metadata: z.record(z.unknown()).optional().nullable()
});

function getSupportAddress() {
  const explicit = process.env.SUPPORT_ADDRESS;
  if (explicit) {
    return explicit.toLowerCase();
  }
  const domain = process.env.RESEND_FROM_DOMAIN ?? "";
  return domain ? `support@${domain}`.toLowerCase() : "";
}

export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch (error) {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = portalSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json({ error: "Invalid payload" }, { status: 400 });
  }

  const data = parsed.data;
  const supportAddress = getSupportAddress();
  if (!supportAddress) {
    return Response.json({ error: "Support address not configured" }, { status: 500 });
  }

  const mailbox = await getOrCreateMailbox(supportAddress, supportAddress);
  const fromEmail = normalizeAddressList(data.from)[0];
  if (!fromEmail) {
    return Response.json({ error: "Invalid sender address" }, { status: 400 });
  }

  const inferredTags = inferTagsFromText({ subject: data.subject, text: data.description });
  const category =
    data.category?.toLowerCase().trim() ?? inferredTags[0]?.toLowerCase() ?? null;
  const metadata = {
    source: "portal",
    ...(data.metadata ?? {})
  };

  const ticketId = await createTicket({
    mailboxId: mailbox.id,
    requesterEmail: fromEmail,
    subject: data.subject,
    category,
    metadata
  });

  await recordTicketEvent({ ticketId, eventType: "ticket_created" });

  if (inferredTags.length) {
    await addTagsToTicket(ticketId, inferredTags);
    await recordTicketEvent({
      ticketId,
      eventType: "tags_assigned",
      data: { tags: inferredTags }
    });
  }

  const messageId = randomUUID();
  const receivedAt = new Date();
  const previewText = data.description.replace(/\s+/g, " ").trim().slice(0, 200);

  await db.query(
    `INSERT INTO messages (
      id, mailbox_id, ticket_id, direction, message_id, thread_id, from_email,
      to_emails, subject, preview_text, received_at, is_read
    ) VALUES (
      $1, $2, $3, 'inbound', $4, $5, $6,
      $7, $8, $9, $10, false
    )`,
    [
      messageId,
      mailbox.id,
      ticketId,
      messageId,
      messageId,
      fromEmail,
      [supportAddress],
      data.subject,
      previewText || null,
      receivedAt
    ]
  );

  const keyPrefix = `messages/${messageId}`;
  const textKey = await putObject({
    key: `${keyPrefix}/body.txt`,
    body: data.description,
    contentType: "text/plain; charset=utf-8"
  });

  await db.query(
    `UPDATE messages
     SET r2_key_text = $1, size_bytes = $2
     WHERE id = $3`,
    [textKey, Buffer.byteLength(data.description), messageId]
  );

  await recordTicketEvent({ ticketId, eventType: "message_received" });

  const threadId = messageId;
  const messageEvent = buildAgentEvent({
    eventType: "ticket.message.created",
    ticketId,
    messageId,
    mailboxId: mailbox.id,
    excerpt: previewText,
    threadId
  });
  const ticketEvent = buildAgentEvent({
    eventType: "ticket.created",
    ticketId,
    mailboxId: mailbox.id,
    excerpt: previewText,
    threadId
  });

  await enqueueAgentEvent({ eventType: "ticket.message.created", payload: messageEvent });
  await enqueueAgentEvent({ eventType: "ticket.created", payload: ticketEvent });
  void deliverPendingAgentEvents().catch(() => {});

  return Response.json({ status: "created", ticketId, messageId });
}
