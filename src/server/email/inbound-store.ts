import { randomUUID } from "crypto";
import { z } from "zod";
import { inboundEmailSchema } from "@/server/email/schema";
import { normalizeAddressList, sanitizeFilename } from "@/server/email/normalize";
import { resolveInboundMailbox } from "@/server/email/mailbox";
import { db } from "@/server/db";
import { putObject } from "@/server/storage/r2";
import {
  addTagsToTicket,
  createTicket,
  inferTagsFromText,
  mergeTicketMetadata,
  recordTicketEvent,
  reopenTicketIfNeeded,
  resolveTicketIdForInbound
} from "@/server/tickets";
import { buildAgentEvent } from "@/server/agents/events";
import { deliverPendingAgentEvents, enqueueAgentEvent } from "@/server/agents/outbox";
import { evaluateSpam } from "@/server/email/spam";
import {
  buildProfileMetadataPatch,
  lookupPredictionProfile
} from "@/server/integrations/prediction-profile";
import { upsertExternalUserLink } from "@/server/integrations/external-user-links";
import {
  attachCustomerToTicket,
  resolveOrCreateCustomerForInbound,
  type CustomerResolutionConflict
} from "@/server/customers";

type InboundEmail = z.infer<typeof inboundEmailSchema>;

function getSupportAddress() {
  const explicit = process.env.SUPPORT_ADDRESS;
  if (explicit) {
    return explicit.toLowerCase();
  }
  const domain = process.env.RESEND_FROM_DOMAIN ?? "";
  return domain ? `support@${domain}`.toLowerCase() : "";
}

function applyIdentityConflictMetadata(
  metadata: Record<string, unknown>,
  conflict: CustomerResolutionConflict
) {
  const next = { ...metadata } as Record<string, unknown>;
  const existingLookup =
    typeof next.profile_lookup === "object" && next.profile_lookup !== null
      ? { ...(next.profile_lookup as Record<string, unknown>) }
      : {};

  existingLookup.status = "conflicted";
  existingLookup.conflict = conflict;
  next.profile_lookup = existingLookup;
  if (typeof next.external_profile === "object" && next.external_profile !== null) {
    next.external_profile_conflict = next.external_profile;
    delete next.external_profile;
  }
  return next;
}

export async function storeInboundEmail(data: InboundEmail) {
  const toList = normalizeAddressList(data.to);
  const ccList = normalizeAddressList(data.cc ?? undefined);
  const bccList = normalizeAddressList(data.bcc ?? undefined);
  const fromEmail = normalizeAddressList(data.from)[0];

  if (!fromEmail || toList.length === 0) {
    throw new Error("Missing from/to addresses");
  }

  const supportAddress = getSupportAddress();
  const primaryRecipient = toList[0];
  const mailbox = await resolveInboundMailbox(primaryRecipient, supportAddress);
  if (!mailbox) {
    throw new Error(`Mailbox ${primaryRecipient} is not configured.`);
  }

  const spamDecision = await evaluateSpam({
    fromEmail,
    subject: data.subject,
    text: data.text
  });

  if (data.messageId) {
    const existing = await db.query(
      "SELECT id, ticket_id FROM messages WHERE message_id = $1 AND mailbox_id = $2 LIMIT 1",
      [data.messageId, mailbox.id]
    );
    if ((existing.rowCount ?? 0) > 0) {
      return {
        status: "duplicate",
        messageId: existing.rows[0].id,
        ticketId: existing.rows[0].ticket_id ?? null,
        mailboxId: mailbox.id
      };
    }
  }

  let ticketId: string | null = null;
  let createdNewTicket = false;
  if (mailbox.type === "platform" && !spamDecision.isSpam) {
    const requesterProfile = await lookupPredictionProfile({ email: fromEmail });
    const customerResolution = await resolveOrCreateCustomerForInbound({
      profile: requesterProfile.status === "matched" ? requesterProfile.profile : null,
      inboundEmail: fromEmail
    });
    const profileMetadataPatch =
      requesterProfile.status === "matched" && customerResolution?.conflict
        ? applyIdentityConflictMetadata(
            buildProfileMetadataPatch(requesterProfile),
            customerResolution.conflict
          )
        : buildProfileMetadataPatch(requesterProfile);

    const references = [data.inReplyTo, ...(data.references ?? [])].filter(
      (value): value is string => Boolean(value)
    );
    ticketId = await resolveTicketIdForInbound(references);
    if (!ticketId) {
      const inferredTags = data.tags?.length
        ? data.tags
        : inferTagsFromText({ subject: data.subject, text: data.text });
      const category =
        data.category?.toLowerCase().trim() ?? inferredTags[0]?.toLowerCase() ?? null;
      const metadata = {
        ...(((data.metadata as Record<string, unknown> | null) ?? {}) as Record<string, unknown>),
        ...profileMetadataPatch
      };

      ticketId = await createTicket({
        mailboxId: mailbox.id,
        customerId: customerResolution?.customerId ?? null,
        requesterEmail: fromEmail,
        subject: data.subject,
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

    if (ticketId && customerResolution?.customerId) {
      const attached = await attachCustomerToTicket(ticketId, customerResolution.customerId);
      if (createdNewTicket || attached) {
        const identityEvent = buildAgentEvent({
          eventType: "customer.identity.resolved",
          ticketId,
          mailboxId: mailbox.id,
          excerpt: `Resolved customer ${customerResolution.customerId}`,
          threadId: data.references?.[0] ?? data.messageId ?? ticketId
        });
        await enqueueAgentEvent({
          eventType: "customer.identity.resolved",
          payload: {
            ...identityEvent,
            customer: {
              id: customerResolution.customerId,
              kind: customerResolution.kind
            },
            identity: {
              email: fromEmail,
              phone: null
            },
            matchedByProfile: requesterProfile.status === "matched",
            ...(customerResolution.conflict ? { conflict: customerResolution.conflict } : {})
          }
        });
      }
    }

    if (requesterProfile.status === "matched" && ticketId && !customerResolution?.conflict) {
      await upsertExternalUserLink({
        externalSystem: "prediction-market-mvp",
        profile: requesterProfile.profile,
        matchedBy: requesterProfile.matchedBy,
        inboundEmail: fromEmail,
        ticketId,
        channel: "email"
      });
    }

    if (createdNewTicket && requesterProfile.status === "matched" && !customerResolution?.conflict) {
      await recordTicketEvent({
        ticketId,
        eventType: "profile_enriched",
        data: {
          source: "prediction-market-mvp",
          matchedBy: requesterProfile.matchedBy,
          externalUserId: requesterProfile.profile.id
        }
      });
    } else if (ticketId && requesterProfile.status === "matched" && customerResolution?.conflict) {
      await recordTicketEvent({
        ticketId,
        eventType: "customer_identity_conflict",
        data: {
          source: "prediction-market-mvp",
          matchedBy: requesterProfile.matchedBy,
          conflict: customerResolution.conflict
        }
      });
    }

    await recordTicketEvent({ ticketId, eventType: "message_received" });
  }

  const messageId = randomUUID();
  const receivedAt = data.date ? new Date(data.date) : new Date();
  const previewSource = data.text ?? "";
  const previewText = previewSource.replace(/\s+/g, " ").trim().slice(0, 200);

  await db.query(
    `INSERT INTO messages (
      id, mailbox_id, ticket_id, direction, message_id, thread_id, in_reply_to, reference_ids,
      from_email, to_emails, cc_emails, bcc_emails, subject, preview_text,
      received_at, is_read, is_spam, spam_reason
    ) VALUES (
      $1, $2, $3, 'inbound', $4, $5, $6, $7,
      $8, $9, $10, $11, $12, $13,
      $14, false, $15, $16
    )`,
    [
      messageId,
      mailbox.id,
      ticketId,
      data.messageId,
      data.references?.[0] ?? data.messageId ?? messageId,
      data.inReplyTo ?? null,
      data.references ?? null,
      fromEmail,
      toList,
      ccList,
      bccList,
      data.subject ?? null,
      previewText || null,
      receivedAt,
      spamDecision.isSpam,
      spamDecision.reason
    ]
  );

  const keyPrefix = `messages/${messageId}`;
  let rawKey: string | null = null;
  let textKey: string | null = null;
  let htmlKey: string | null = null;
  let sizeBytes = 0;

  if (data.raw) {
    const rawBuffer = Buffer.from(data.raw, "base64");
    rawKey = await putObject({
      key: `${keyPrefix}/raw.eml`,
      body: rawBuffer,
      contentType: "message/rfc822"
    });
    sizeBytes += rawBuffer.length;
  }

  if (data.text) {
    textKey = await putObject({
      key: `${keyPrefix}/body.txt`,
      body: data.text,
      contentType: "text/plain; charset=utf-8"
    });
    sizeBytes += Buffer.byteLength(data.text);
  }

  if (data.html) {
    htmlKey = await putObject({
      key: `${keyPrefix}/body.html`,
      body: data.html,
      contentType: "text/html; charset=utf-8"
    });
    sizeBytes += Buffer.byteLength(data.html);
  }

  if (data.attachments?.length) {
    for (const attachment of data.attachments) {
      if (!attachment.contentBase64) {
        continue;
      }
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
          attachment.size ?? buffer.length,
          key
        ]
      );
    }
  }

  await db.query(
    `UPDATE messages
     SET r2_key_raw = $1, r2_key_text = $2, r2_key_html = $3, size_bytes = $4
     WHERE id = $5`,
    [rawKey, textKey, htmlKey, sizeBytes || null, messageId]
  );

  if (mailbox.type === "platform" && ticketId && !spamDecision.isSpam) {
    const threadId = data.references?.[0] ?? data.messageId ?? messageId;
    const messageEvent = buildAgentEvent({
      eventType: "ticket.message.created",
      ticketId,
      messageId,
      mailboxId: mailbox.id,
      excerpt: previewText,
      threadId
    });
    await enqueueAgentEvent({ eventType: "ticket.message.created", payload: messageEvent });

    if (createdNewTicket) {
      const ticketEvent = buildAgentEvent({
        eventType: "ticket.created",
        ticketId,
        mailboxId: mailbox.id,
        excerpt: previewText,
        threadId
      });
      await enqueueAgentEvent({ eventType: "ticket.created", payload: ticketEvent });
    }

    void deliverPendingAgentEvents().catch(() => {});
  }

  return { status: "stored", messageId, ticketId, mailboxId: mailbox.id };
}
