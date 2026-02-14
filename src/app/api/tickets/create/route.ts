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
import { sendTicketReply } from "@/server/email/replies";

const createTicketSchema = z.object({
  to: z.string().email().optional(),
  from: z.string().email().optional(),
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

function readString(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function enrichExternalProfileMetadata(metadata: Record<string, unknown> | null) {
  if (!metadata) return null;

  const hasExternalProfile =
    typeof metadata.external_profile === "object" && metadata.external_profile !== null;
  if (hasExternalProfile) {
    return metadata;
  }

  const email = readString(metadata.appUserEmail);
  const isAuthenticated = metadata.isAuthenticated === true;
  if (!isAuthenticated || !email) {
    return metadata;
  }

  const matchedAt = new Date().toISOString();
  return {
    ...metadata,
    external_profile: {
      source: "prediction-market-mvp-webchat",
      externalUserId: readString(metadata.appUserId),
      matchedBy: "session_auth",
      matchedAt,
      fullName: readString(metadata.appUserFullName),
      email,
      secondaryEmail: readString(metadata.appUserSecondaryEmail),
      phoneNumber: readString(metadata.appUserPhone),
      kycStatus: readString(metadata.appUserKycStatus),
      accountStatus: readString(metadata.appUserAccountStatus)
    },
    profile_lookup: {
      source: "prediction-market-mvp-webchat",
      status: "matched",
      matchedBy: "session_auth",
      lookupAt: matchedAt
    }
  } as Record<string, unknown>;
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
  const inferredTags = data.tags?.length
    ? data.tags
    : inferTagsFromText({ subject: data.subject, text: data.description });
  const category =
    data.category?.toLowerCase().trim() ?? inferredTags[0]?.toLowerCase() ?? null;
  const previewText = data.description.replace(/\s+/g, " ").trim().slice(0, 200);

  // Support agents creating tickets from CRM send outbound first contact.
  if (sessionUser) {
    const toEmail = normalizeAddressList(data.to ?? data.from ?? "")[0];
    if (!toEmail) {
      return Response.json({ error: "Email to is required" }, { status: 400 });
    }

    const ticketId = await createTicket({
      mailboxId: mailbox.id,
      requesterEmail: toEmail,
      subject: data.subject,
      category,
      metadata: {
        source: "manual_outbound",
        createdByUserId: sessionUser.id,
        ...(data.metadata ?? {})
      } as Record<string, unknown>
    });

    await recordTicketEvent({
      ticketId,
      eventType: "ticket_created",
      actorUserId: sessionUser.id
    });

    if (inferredTags.length) {
      await addTagsToTicket(ticketId, inferredTags);
      await recordTicketEvent({
        ticketId,
        eventType: "tags_assigned",
        actorUserId: sessionUser.id,
        data: { tags: inferredTags }
      });
    }

    const sendResult = await sendTicketReply({
      ticketId,
      subject: data.subject,
      text: data.description,
      html: data.descriptionHtml ?? null,
      attachments: data.attachments ?? null,
      actorUserId: sessionUser.id,
      origin: "human"
    });

    const messageId = sendResult.messageId ?? null;
    const threadId = messageId;
    const ticketEvent = buildAgentEvent({
      eventType: "ticket.created",
      ticketId,
      mailboxId: mailbox.id,
      excerpt: previewText,
      threadId
    });
    await enqueueAgentEvent({ eventType: "ticket.created", payload: ticketEvent });

    if (messageId) {
      const messageEvent = buildAgentEvent({
        eventType: "ticket.message.created",
        ticketId,
        messageId,
        mailboxId: mailbox.id,
        excerpt: previewText,
        threadId
      });
      await enqueueAgentEvent({ eventType: "ticket.message.created", payload: messageEvent });
    }

    void deliverPendingAgentEvents().catch(() => {});
    return Response.json({ status: "created", ticketId, messageId });
  }

  // External platform callers create inbound tickets (end-user initiated).
  const fromEmail = normalizeAddressList(data.from ?? data.to ?? "")[0];
  if (!fromEmail) {
    return Response.json({ error: "Invalid sender address" }, { status: 400 });
  }

  const ticketId = await createTicket({
    mailboxId: mailbox.id,
    requesterEmail: fromEmail,
    subject: data.subject,
    category,
    metadata: enrichExternalProfileMetadata(
      (data.metadata as Record<string, unknown> | null) ?? null
    )
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
