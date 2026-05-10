import { randomUUID } from "crypto";
import { z } from "zod";
import { inboundEmailSchema } from "@/server/email/schema";
import { normalizeAddressList, sanitizeFilename } from "@/server/email/normalize";
import { resolveInboundMailbox } from "@/server/email/mailbox";
import { db } from "@/server/db";
import { putObject } from "@/server/storage/r2";
import {
  inferTagsFromText,
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
  const tenantId = mailbox.tenant_id;

  const spamDecision = await evaluateSpam({
    fromEmail,
    subject: data.subject,
    text: data.text
  });

  // ── Idempotency check (outside transaction, read-only) ──
  if (data.messageId) {
    const existing = await db.query(
      "SELECT id, ticket_id FROM messages WHERE message_id = $1 AND mailbox_id = $2 AND tenant_id = $3 LIMIT 1",
      [data.messageId, mailbox.id, tenantId]
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

  // ── Phase 1: Resolve all external/network data BEFORE the transaction ──
  let requesterProfile: Awaited<ReturnType<typeof lookupPredictionProfile>> | null = null;
  let customerResolution: Awaited<ReturnType<typeof resolveOrCreateCustomerForInbound>> | null = null;
  let profileMetadataPatch: Record<string, unknown> = {};
  let existingTicketId: string | null = null;
  let inferredTags: string[] = [];

  if (mailbox.type === "platform" && !spamDecision.isSpam) {
    requesterProfile = await lookupPredictionProfile({ email: fromEmail });
    customerResolution = await resolveOrCreateCustomerForInbound({
      tenantId,
      profile: requesterProfile.status === "matched" ? requesterProfile.profile : null,
      inboundEmail: fromEmail
    });
    profileMetadataPatch =
      requesterProfile.status === "matched" && customerResolution?.conflict
        ? applyIdentityConflictMetadata(
            buildProfileMetadataPatch(requesterProfile),
            customerResolution.conflict
          )
        : buildProfileMetadataPatch(requesterProfile);

    const references = [data.inReplyTo, ...(data.references ?? [])].filter(
      (value): value is string => Boolean(value)
    );
    existingTicketId = await resolveTicketIdForInbound(references, tenantId);

    if (!existingTicketId) {
      inferredTags = data.tags?.length
        ? data.tags
        : inferTagsFromText({ subject: data.subject, text: data.text });
    }
  }

  // Decode attachment content into memory before the transaction
  type ResolvedAttachment = {
    attachmentId: string;
    safeFilename: string;
    buffer: Buffer;
    contentType: string | null;
    size: number;
    originalFilename: string;
  };
  const resolvedAttachments: ResolvedAttachment[] = [];

  if (data.attachments?.length) {
    for (const attachment of data.attachments) {
      if (!attachment.contentBase64) {
        continue;
      }
      const attachmentId = randomUUID();
      const safeFilename = sanitizeFilename(attachment.filename);
      const buffer = Buffer.from(attachment.contentBase64, "base64");

      resolvedAttachments.push({
        attachmentId,
        safeFilename,
        buffer,
        contentType: attachment.contentType ?? null,
        size: attachment.size ?? buffer.length,
        originalFilename: attachment.filename
      });
    }
  }

  const messageId = randomUUID();
  const receivedAt = data.date ? new Date(data.date) : new Date();
  const previewSource = data.text ?? "";
  const previewText = previewSource.replace(/\s+/g, " ").trim().slice(0, 200);

  // ── Phase 2: Atomic database transaction ──
  // All database mutations happen inside a single transaction so that
  // a failure at any point rolls back cleanly — no ghost tickets.
  let ticketId: string | null = null;
  let createdNewTicket = false;
  let attachedCustomerToTicket = false;

  const client = await db.connect();
  try {
    await client.query("BEGIN");

    if (mailbox.type === "platform" && !spamDecision.isSpam) {
      ticketId = existingTicketId;

      if (!ticketId) {
        const category =
          data.category?.toLowerCase().trim() ?? inferredTags[0]?.toLowerCase() ?? null;
        const metadata = {
          ...(((data.metadata as Record<string, unknown> | null) ?? {}) as Record<string, unknown>),
          ...profileMetadataPatch
        };

        const ticketResult = await client.query<{ id: string }>(
          `INSERT INTO tickets (tenant_id, mailbox_id, customer_id, requester_email, subject, category, metadata)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING id`,
          [
            tenantId,
            mailbox.id,
            customerResolution?.customerId ?? null,
            fromEmail,
            data.subject ?? null,
            category,
            metadata ?? {}
          ]
        );
        ticketId = ticketResult.rows[0].id;
        createdNewTicket = true;

        await client.query(
          `INSERT INTO ticket_events (tenant_id, ticket_id, event_type, actor_user_id, data)
           VALUES ($1, $2, $3, $4, $5)`,
          [tenantId, ticketId, "ticket_created", null, null]
        );

        if (inferredTags.length) {
          const cleanTags = Array.from(new Set(inferredTags.map((t) => t.toLowerCase().trim()).filter(Boolean)));
          for (const tag of cleanTags) {
            const tagResult = await client.query<{ id: string }>(
              `INSERT INTO tags (name) VALUES ($1) ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
              [tag]
            );
            await client.query(
              `INSERT INTO ticket_tags (ticket_id, tag_id) VALUES ($1, $2) ON CONFLICT (ticket_id, tag_id) DO NOTHING`,
              [ticketId, tagResult.rows[0].id]
            );
          }
          await client.query(
            `INSERT INTO ticket_events (tenant_id, ticket_id, event_type, actor_user_id, data)
             VALUES ($1, $2, $3, $4, $5)`,
            [tenantId, ticketId, "tags_assigned", null, { tags: inferredTags }]
          );
        }
      } else {
        // Reopen ticket if it was resolved/closed
        const statusResult = await client.query<{ status: string }>(
          "SELECT status FROM tickets WHERE id = $1 AND tenant_id = $2",
          [ticketId, tenantId]
        );
        const currentStatus = statusResult.rows[0]?.status;
        if (currentStatus === "solved" || currentStatus === "closed") {
          await client.query(
            "UPDATE tickets SET status = 'open', updated_at = now() WHERE id = $1 AND tenant_id = $2",
            [ticketId, tenantId]
          );
          await client.query(
            `INSERT INTO ticket_events (tenant_id, ticket_id, event_type, actor_user_id, data)
             VALUES ($1, $2, $3, $4, $5)`,
            [tenantId, ticketId, "ticket_reopened", null, { previousStatus: currentStatus }]
          );
        }

        if (requesterProfile?.status === "matched") {
          await client.query(
          `UPDATE tickets
             SET metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb,
                 updated_at = now()
             WHERE id = $1
               AND tenant_id = $3`,
            [ticketId, JSON.stringify(profileMetadataPatch), tenantId]
          );
        }
      }

      if (ticketId && customerResolution?.customerId) {
        const customerAttachResult = await client.query(
          `UPDATE tickets SET customer_id = $2, updated_at = now()
           WHERE id = $1
             AND tenant_id = $3
             AND (customer_id IS NULL OR customer_id != $2)
             AND EXISTS (
               SELECT 1
               FROM customers c
               WHERE c.id = $2
                 AND c.tenant_id = $3
             )`,
          [ticketId, customerResolution.customerId, tenantId]
        );
        attachedCustomerToTicket = (customerAttachResult.rowCount ?? 0) > 0;
      }

      if (requesterProfile?.status === "matched" && ticketId && !customerResolution?.conflict) {
        await upsertExternalUserLink({
          externalSystem: "prediction-market-mvp",
          profile: requesterProfile.profile,
          matchedBy: requesterProfile.matchedBy,
          inboundEmail: fromEmail,
          ticketId,
          channel: "email",
          queryExecutor: client
        });
      }

      if (createdNewTicket && requesterProfile?.status === "matched" && !customerResolution?.conflict) {
        await client.query(
          `INSERT INTO ticket_events (tenant_id, ticket_id, event_type, actor_user_id, data)
           VALUES ($1, $2, $3, $4, $5)`,
          [tenantId, ticketId, "profile_enriched", null, {
            source: "prediction-market-mvp",
            matchedBy: requesterProfile.matchedBy,
            externalUserId: requesterProfile.profile.id
          }]
        );
      } else if (ticketId && requesterProfile?.status === "matched" && customerResolution?.conflict) {
        await client.query(
          `INSERT INTO ticket_events (tenant_id, ticket_id, event_type, actor_user_id, data)
           VALUES ($1, $2, $3, $4, $5)`,
          [tenantId, ticketId, "customer_identity_conflict", null, {
            source: "prediction-market-mvp",
            matchedBy: requesterProfile.matchedBy,
            conflict: customerResolution.conflict
          }]
        );
      }

      await client.query(
        `INSERT INTO ticket_events (tenant_id, ticket_id, event_type, actor_user_id, data)
         VALUES ($1, $2, $3, $4, $5)`,
        [tenantId, ticketId, "message_received", null, null]
      );
    }

    // Insert the message row
    await client.query(
      `INSERT INTO messages (
        tenant_id, id, mailbox_id, ticket_id, direction, message_id, thread_id, in_reply_to, reference_ids,
        from_email, to_emails, cc_emails, bcc_emails, subject, preview_text,
        received_at, is_read, is_spam, spam_reason
      ) VALUES (
        $1, $2, $3, $4, 'inbound', $5, $6, $7, $8,
        $9, $10, $11, $12, $13, $14,
        $15, false, $16, $17
      )`,
      [
        tenantId,
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

    // Insert attachment metadata rows (buffers already decoded in memory)
    for (const resolved of resolvedAttachments) {
      const r2Key = `messages/${messageId}/attachments/${resolved.attachmentId}-${resolved.safeFilename}`;
      await client.query(
        `INSERT INTO attachments (tenant_id, id, message_id, filename, content_type, size_bytes, r2_key)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          tenantId,
          resolved.attachmentId,
          messageId,
          resolved.originalFilename,
          resolved.contentType,
          resolved.size,
          r2Key
        ]
      );
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  // ── Phase 3: Post-commit side effects (R2 uploads, agent events) ──
  // These run after the transaction commits. If they fail, the DB state
  // is consistent and the data can be backfilled or retried.
  const keyPrefix = `messages/${messageId}`;
  let rawKey: string | null = null;
  let textKey: string | null = null;
  let htmlKey: string | null = null;
  let sizeBytes = 0;
  const failedStorageItems: Array<{ kind: string; target: string; detail: string }> = [];

  if (data.raw) {
    try {
      const rawBuffer = Buffer.from(data.raw, "base64");
      rawKey = await putObject({
        key: `${keyPrefix}/raw.eml`,
        body: rawBuffer,
        contentType: "message/rfc822"
      });
      sizeBytes += rawBuffer.length;
    } catch (error) {
      failedStorageItems.push({
        kind: "raw",
        target: `${keyPrefix}/raw.eml`,
        detail: error instanceof Error ? error.message : "unknown upload error"
      });
    }
  }

  if (data.text) {
    try {
      textKey = await putObject({
        key: `${keyPrefix}/body.txt`,
        body: data.text,
        contentType: "text/plain; charset=utf-8"
      });
      sizeBytes += Buffer.byteLength(data.text);
    } catch (error) {
      failedStorageItems.push({
        kind: "text",
        target: `${keyPrefix}/body.txt`,
        detail: error instanceof Error ? error.message : "unknown upload error"
      });
    }
  }

  if (data.html) {
    try {
      htmlKey = await putObject({
        key: `${keyPrefix}/body.html`,
        body: data.html,
        contentType: "text/html; charset=utf-8"
      });
      sizeBytes += Buffer.byteLength(data.html);
    } catch (error) {
      failedStorageItems.push({
        kind: "html",
        target: `${keyPrefix}/body.html`,
        detail: error instanceof Error ? error.message : "unknown upload error"
      });
    }
  }

  for (const resolved of resolvedAttachments) {
    const r2Key = `messages/${messageId}/attachments/${resolved.attachmentId}-${resolved.safeFilename}`;
    try {
      await putObject({
        key: r2Key,
        body: resolved.buffer,
        contentType: resolved.contentType ?? undefined
      });
      sizeBytes += resolved.size;
    } catch (error) {
      failedStorageItems.push({
        kind: "attachment",
        target: resolved.originalFilename,
        detail: error instanceof Error ? error.message : "unknown upload error"
      });
      await db
        .query(`DELETE FROM attachments WHERE id = $1 AND tenant_id = $2`, [
          resolved.attachmentId,
          tenantId
        ])
        .catch(() => {});
    }
  }

  await db.query(
    `UPDATE messages
     SET r2_key_raw = $1, r2_key_text = $2, r2_key_html = $3, size_bytes = $4
     WHERE id = $5
       AND tenant_id = $6`,
    [rawKey, textKey, htmlKey, sizeBytes || null, messageId, tenantId]
  );

  if (mailbox.type === "platform" && ticketId && !spamDecision.isSpam) {
    const threadId = data.references?.[0] ?? data.messageId ?? messageId;
    const messageEvent = buildAgentEvent({
      eventType: "ticket.message.created",
      ticketId,
      messageId,
      mailboxId: mailbox.id,
      tenantId,
      excerpt: previewText,
      threadId
    });
    await enqueueAgentEvent({ eventType: "ticket.message.created", payload: messageEvent, tenantId });

    if (createdNewTicket) {
      const ticketEvent = buildAgentEvent({
        eventType: "ticket.created",
        ticketId,
        mailboxId: mailbox.id,
        tenantId,
        excerpt: previewText,
        threadId
      });
      await enqueueAgentEvent({ eventType: "ticket.created", payload: ticketEvent, tenantId });
    }

    if (ticketId && customerResolution?.customerId && (createdNewTicket || attachedCustomerToTicket)) {
      const identityEvent = buildAgentEvent({
        eventType: "customer.identity.resolved",
        ticketId,
        mailboxId: mailbox.id,
        tenantId,
        excerpt: `Resolved customer ${customerResolution.customerId}`,
        threadId
      });
      await enqueueAgentEvent({
        eventType: "customer.identity.resolved",
        tenantId,
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
          matchedByProfile: requesterProfile?.status === "matched",
          ...(customerResolution.conflict ? { conflict: customerResolution.conflict } : {})
        }
      });
    }

    if (failedStorageItems.length > 0) {
      await db
        .query(
          `INSERT INTO ticket_events (tenant_id, ticket_id, event_type, actor_user_id, data)
           VALUES ($1, $2, $3, $4, $5)`,
          [
            tenantId,
            ticketId,
            "message_storage_partial",
            null,
            {
              messageId,
              failedItems: failedStorageItems
            }
          ]
        )
        .catch(() => {});
    }

    void deliverPendingAgentEvents({ tenantId }).catch(() => {});
  }

  return { status: "stored", messageId, ticketId, mailboxId: mailbox.id };
}
