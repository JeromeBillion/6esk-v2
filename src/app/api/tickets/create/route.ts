import { randomUUID } from "crypto";
import { z } from "zod";
import { db } from "@/server/db";
import { getOrCreateMailbox } from "@/server/email/mailbox";
import { normalizeAddressList, sanitizeFilename } from "@/server/email/normalize";
import { putObject } from "@/server/storage/r2";
import {
  addTagsToTicket,
  createTicket,
  inferTagsFromText,
  recordTicketEvent
} from "@/server/tickets";
import { getSessionUser } from "@/server/auth/session";
import { canManageTickets } from "@/server/auth/roles";
import { buildAgentEvent } from "@/server/agents/events";
import { deliverPendingAgentEvents, enqueueAgentEvent } from "@/server/agents/outbox";

const createTicketSchema = z.object({
  from: z.string().email(),
  subject: z.string().min(1),
  description: z.string().min(1),
  descriptionHtml: z.string().optional().nullable(),
  category: z.string().optional().nullable(),
  tags: z.array(z.string()).optional().nullable(),
  metadata: z.record(z.unknown()).optional().nullable(),
  attachments: z
    .array(
      z.object({
        filename: z.string().min(1),
        contentType: z.string().optional().nullable(),
        contentBase64: z.string().min(1)
      })
    )
    .optional()
    .nullable()
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
  const sharedSecret = process.env.INBOUND_SHARED_SECRET ?? "";
  const provided = request.headers.get("x-6esk-secret");
  const sessionUser = await getSessionUser();

  if (sessionUser && !canManageTickets(sessionUser)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!sessionUser && (!sharedSecret || provided !== sharedSecret)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch (error) {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = createTicketSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid payload", details: parsed.error.flatten() },
      { status: 400 }
    );
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

  const inferredTags = data.tags?.length
    ? data.tags
    : inferTagsFromText({ subject: data.subject, text: data.description });
  const category =
    data.category?.toLowerCase().trim() ?? inferredTags[0]?.toLowerCase() ?? null;

  const ticketId = await createTicket({
    mailboxId: mailbox.id,
    requesterEmail: fromEmail,
    subject: data.subject,
    category,
    metadata: (data.metadata as Record<string, unknown> | null) ?? null
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
  let textKey: string | null = null;
  let htmlKey: string | null = null;
  let sizeBytes = 0;

  textKey = await putObject({
    key: `${keyPrefix}/body.txt`,
    body: data.description,
    contentType: "text/plain; charset=utf-8"
  });
  sizeBytes += Buffer.byteLength(data.description);

  if (data.descriptionHtml) {
    htmlKey = await putObject({
      key: `${keyPrefix}/body.html`,
      body: data.descriptionHtml,
      contentType: "text/html; charset=utf-8"
    });
    sizeBytes += Buffer.byteLength(data.descriptionHtml);
  }

  if (data.attachments?.length) {
    for (const attachment of data.attachments) {
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
          buffer.length,
          key
        ]
      );
    }
  }

  await db.query(
    `UPDATE messages
     SET r2_key_text = $1, r2_key_html = $2, size_bytes = $3
     WHERE id = $4`,
    [textKey, htmlKey, sizeBytes || null, messageId]
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
