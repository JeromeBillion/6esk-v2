import { getOrCreateMailbox } from "@/server/email/mailbox";
import { addTagsToTicket, createTicket, inferTagsFromText, recordTicketEvent } from "@/server/tickets";
import { resolveOrCreateCustomerForInbound } from "@/server/customers";
import { syncVoiceConsentFromMetadata } from "@/server/calls/consent";
import { sendTicketReply } from "@/server/email/replies";
import { buildAgentEvent } from "@/server/agents/events";
import { deliverPendingAgentEvents, enqueueAgentEvent } from "@/server/agents/outbox";

type OutboundEmailAttachment = {
  filename: string;
  contentType?: string | null;
  size?: number | null;
  contentBase64: string;
};

export type CreateOutboundEmailTicketArgs = {
  actorUserId: string;
  toEmail: string;
  subject: string;
  text?: string | null;
  html?: string | null;
  category?: string | null;
  tags?: string[] | null;
  metadata?: Record<string, unknown> | null;
  attachments?: OutboundEmailAttachment[] | null;
  customerId?: string | null;
  contextRoute?: string;
  deliverAgentEvents?: boolean;
};

function getSupportAddress() {
  const explicit = process.env.SUPPORT_ADDRESS;
  if (explicit) {
    return explicit.toLowerCase();
  }
  const domain = process.env.RESEND_FROM_DOMAIN ?? "";
  return domain ? `support@${domain}`.toLowerCase() : "";
}

function toPlainText(text?: string | null, html?: string | null) {
  const plain = text?.trim() ?? "";
  if (plain) {
    return plain;
  }
  return html?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() ?? "";
}

export async function createOutboundEmailTicket({
  actorUserId,
  toEmail,
  subject,
  text,
  html,
  category,
  tags,
  metadata,
  attachments,
  customerId,
  contextRoute = "/api/tickets/create",
  deliverAgentEvents = true
}: CreateOutboundEmailTicketArgs) {
  const supportAddress = getSupportAddress();
  if (!supportAddress) {
    throw new Error("Support address not configured");
  }

  const plainText = toPlainText(text, html);
  if (!plainText && !html?.trim()) {
    throw new Error("Description is required");
  }

  const mailbox = await getOrCreateMailbox(supportAddress, supportAddress);
  const inferredTags = (tags?.length ? tags : inferTagsFromText({ subject, text: plainText || null }))
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean);
  const normalizedTags = Array.from(new Set(inferredTags));
  const resolvedCategory = category?.toLowerCase().trim() ?? normalizedTags[0]?.toLowerCase() ?? null;
  const resolvedCustomerId =
    customerId ?? (await resolveOrCreateCustomerForInbound({ inboundEmail: toEmail }))?.customerId ?? null;

  await syncVoiceConsentFromMetadata({
    metadata: metadata ?? null,
    customerId: resolvedCustomerId,
    fallbackEmail: toEmail,
    defaultSource:
      typeof metadata?.source === "string" && metadata.source.trim()
        ? metadata.source.trim()
        : "manual_outbound",
    consentTermsVersion: process.env.CALLS_CONSENT_TERMS_VERSION ?? null,
    context: {
      route: contextRoute,
      contactMode: "email",
      actorUserId
    }
  });

  const ticketId = await createTicket({
    mailboxId: mailbox.id,
    customerId: resolvedCustomerId,
    requesterEmail: toEmail,
    subject,
    category: resolvedCategory,
    metadata: metadata ?? {}
  });

  await recordTicketEvent({
    ticketId,
    eventType: "ticket_created",
    actorUserId
  });

  if (normalizedTags.length > 0) {
    await addTagsToTicket(ticketId, normalizedTags);
    await recordTicketEvent({
      ticketId,
      eventType: "tags_assigned",
      actorUserId,
      data: { tags: normalizedTags }
    });
  }

  const sendResult = await sendTicketReply({
    ticketId,
    subject,
    text: plainText || null,
    html: html ?? null,
    attachments: attachments ?? null,
    actorUserId,
    origin: "human"
  });

  const messageId = sendResult.messageId ?? null;
  const previewText = plainText.slice(0, 200);
  const threadId = messageId;
  const ticketEvent = buildAgentEvent({
    eventType: "ticket.created",
    ticketId,
    mailboxId: mailbox.id,
    actorUserId,
    excerpt: previewText || subject,
    threadId
  });
  await enqueueAgentEvent({ eventType: "ticket.created", payload: ticketEvent });

  if (messageId) {
    const messageEvent = buildAgentEvent({
      eventType: "ticket.message.created",
      ticketId,
      messageId,
      mailboxId: mailbox.id,
      actorUserId,
      excerpt: previewText || subject,
      threadId
    });
    await enqueueAgentEvent({ eventType: "ticket.message.created", payload: messageEvent });
  }

  if (deliverAgentEvents) {
    void deliverPendingAgentEvents().catch(() => {});
  }

  return {
    ticketId,
    messageId,
    mailboxId: mailbox.id,
    category: resolvedCategory,
    tags: normalizedTags
  };
}
