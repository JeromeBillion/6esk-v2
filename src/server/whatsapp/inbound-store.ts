import { randomUUID } from "crypto";
import { db } from "@/server/db";
import { decryptSecret } from "@/server/agents/secret";
import { getOrCreateMailbox } from "@/server/email/mailbox";
import { sanitizeFilename } from "@/server/email/normalize";
import { putObject } from "@/server/storage/r2";
import {
  addTagsToTicket,
  createTicket,
  inferTagsFromText,
  mergeTicketMetadata,
  recordTicketEvent,
  reopenTicketIfNeeded
} from "@/server/tickets";
import { buildAgentEvent } from "@/server/agents/events";
import { deliverPendingAgentEvents, enqueueAgentEvent } from "@/server/agents/outbox";
import {
  buildProfileMetadataPatch,
  lookupPredictionProfile
} from "@/server/integrations/prediction-profile";

export type NormalizedWhatsAppAttachment = {
  mediaId?: string | null;
  mimeType?: string | null;
  filename?: string | null;
  caption?: string | null;
  type?: string | null;
  contentBase64?: string | null;
};

export type NormalizedWhatsAppMessage = {
  provider: string;
  messageId?: string | null;
  conversationId?: string | null;
  from: string;
  to?: string | null;
  text?: string | null;
  timestamp?: string | number | null;
  contactName?: string | null;
  attachments?: NormalizedWhatsAppAttachment[] | null;
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

const GRAPH_VERSION = process.env.WHATSAPP_GRAPH_VERSION ?? "v19.0";

async function getActiveAccessToken() {
  const result = await db.query<{ access_token: string | null; provider: string }>(
    `SELECT access_token, provider
     FROM whatsapp_accounts
     WHERE status = 'active'
     ORDER BY created_at DESC
     LIMIT 1`
  );
  const record = result.rows[0];
  if (!record) return null;
  if (record.provider !== "meta") return null;
  const token = record.access_token ? decryptSecret(record.access_token) : "";
  return token || null;
}

async function fetchMetaMedia(accessToken: string, mediaId: string) {
  const infoUrl = `https://graph.facebook.com/${GRAPH_VERSION}/${mediaId}`;
  const infoResponse = await fetch(infoUrl, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!infoResponse.ok) {
    const errorBody = await infoResponse.text();
    throw new Error(errorBody || `Failed to fetch WhatsApp media (${infoResponse.status})`);
  }
  const info = (await infoResponse.json()) as {
    url?: string;
    mime_type?: string;
    file_size?: number;
    filename?: string;
  };
  if (!info.url) {
    throw new Error("Missing WhatsApp media URL");
  }
  const mediaResponse = await fetch(info.url, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!mediaResponse.ok) {
    const errorBody = await mediaResponse.text();
    throw new Error(errorBody || `Failed to download WhatsApp media (${mediaResponse.status})`);
  }
  const arrayBuffer = await mediaResponse.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  return {
    buffer,
    mimeType: info.mime_type ?? null,
    filename: info.filename ?? null,
    size: typeof info.file_size === "number" ? info.file_size : buffer.length
  };
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

  const requesterProfile = await lookupPredictionProfile({ phone: from });
  const profileMetadataPatch = buildProfileMetadataPatch(requesterProfile);

  const mailbox = await getOrCreateMailbox(supportAddress, supportAddress);
  const conversationId = message.conversationId ?? from;

  let ticketId: string | null = await resolveWhatsAppTicketId(conversationId);
  let createdNewTicket = false;

  const attachments = (message.attachments ?? []).filter(Boolean);
  const fallbackCaption =
    attachments.find((item) => item?.caption)?.caption ?? null;
  const previewSource = message.text ?? fallbackCaption ?? "";
  const previewText = previewSource.replace(/\s+/g, " ").trim().slice(0, 200);
  const attachmentHint = attachments.length
    ? attachments[0]?.filename
      ? `Attachment: ${attachments[0].filename}`
      : `${attachments.length} attachment${attachments.length === 1 ? "" : "s"}`
    : "";
  const subject = previewText
    ? `WhatsApp: ${previewText.slice(0, 60)}`
    : attachmentHint
      ? `WhatsApp: ${attachmentHint}`
      : `WhatsApp from ${from}`;

  if (!ticketId) {
    const inferredTags = inferTagsFromText({ subject: null, text: message.text ?? null });
    const category = inferredTags[0]?.toLowerCase() ?? null;
    const metadata = {
      channel: "whatsapp",
      wa_contact: from,
      provider: message.provider ?? "meta",
      contact_name: message.contactName ?? null,
      ...profileMetadataPatch
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
    if (requesterProfile.status === "matched") {
      await mergeTicketMetadata(ticketId, profileMetadataPatch);
    }
  }

  if (createdNewTicket && requesterProfile.status === "matched") {
    await recordTicketEvent({
      ticketId,
      eventType: "profile_enriched",
      data: {
        source: "prediction-market-mvp",
        matchedBy: requesterProfile.matchedBy,
        externalUserId: requesterProfile.profile.id
      }
    });
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
      previewText
        ? `WhatsApp: ${previewText.slice(0, 80)}`
        : attachmentHint
          ? `WhatsApp: ${attachmentHint}`
          : null,
      previewText || attachmentHint || null,
      receivedAt
    ]
  );

  await db.query(
    `INSERT INTO whatsapp_status_events (message_id, external_message_id, status, occurred_at, payload)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      messageId,
      message.messageId ?? null,
      "received",
      receivedAt,
      { source: "inbound", status: "received" }
    ]
  );

  let textKey: string | null = null;
  let sizeBytes = 0;

  if (message.text || fallbackCaption) {
    const bodyText = message.text ?? fallbackCaption ?? "";
    textKey = await putObject({
      key: `messages/${messageId}/body.txt`,
      body: bodyText,
      contentType: "text/plain; charset=utf-8"
    });
    sizeBytes += Buffer.byteLength(bodyText);
  }

  if (attachments.length) {
    const accessToken = await getActiveAccessToken();
    for (const attachment of attachments) {
      const attachmentId = randomUUID();
      const safeFilename = sanitizeFilename(
        attachment.filename ?? `${attachment.type ?? "attachment"}-${attachmentId}`
      );
      let buffer: Buffer | null = null;
      let contentType = attachment.mimeType ?? null;
      let size: number | null = null;

      if (attachment.contentBase64) {
        buffer = Buffer.from(attachment.contentBase64, "base64");
        size = buffer.length;
      } else if (attachment.mediaId && accessToken) {
        const fetched = await fetchMetaMedia(accessToken, attachment.mediaId);
        buffer = fetched.buffer;
        contentType = contentType ?? fetched.mimeType ?? null;
        size = fetched.size ?? buffer.length;
        if (!attachment.filename && fetched.filename) {
          attachment.filename = fetched.filename;
        }
      }

      if (!buffer) {
        continue;
      }

      const key = `messages/${messageId}/attachments/${attachmentId}-${safeFilename}`;
      await putObject({
        key,
        body: buffer,
        contentType: contentType ?? undefined
      });

      await db.query(
        `INSERT INTO attachments (id, message_id, filename, content_type, size_bytes, r2_key)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          attachmentId,
          messageId,
          attachment.filename ?? safeFilename,
          contentType ?? null,
          size ?? buffer.length,
          key
        ]
      );
      sizeBytes += size ?? buffer.length;
    }
  }

  if (textKey || sizeBytes) {
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
