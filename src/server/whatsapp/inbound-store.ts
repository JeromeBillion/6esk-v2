import { randomUUID } from "crypto";
import { db } from "@/server/db";
import { decryptSecret } from "@/server/agents/secret";
import { getOrCreateMailbox } from "@/server/email/mailbox";
import { sanitizeFilename } from "@/server/email/normalize";
import { putObject } from "@/server/storage/r2";
import {
  inferTagsFromText,
} from "@/server/tickets";
import { buildAgentEvent } from "@/server/agents/events";
import { deliverPendingAgentEvents, enqueueAgentEvent } from "@/server/agents/outbox";
import {
  buildProfileMetadataPatch,
  lookupPredictionProfile
} from "@/server/integrations/prediction-profile";
import { upsertExternalUserLink } from "@/server/integrations/external-user-links";
import {
  resolveOrCreateCustomerForInbound,
  type CustomerResolutionConflict
} from "@/server/customers";

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

type WhatsAppInboundAccount = {
  id: string;
  tenant_id: string;
  provider: string;
  phone_number: string;
  waba_id: string | null;
  access_token: string | null;
};

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

function normalizeContact(value: string) {
  return value.replace(/\s+/g, "").trim();
}

function normalizeDigits(value: string | null | undefined) {
  return (value ?? "").replace(/\D/g, "");
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

async function listActiveWhatsAppAccounts(provider?: string | null) {
  const result = await db.query<WhatsAppInboundAccount>(
    `SELECT id, tenant_id, provider, phone_number, waba_id, access_token
     FROM whatsapp_accounts
     WHERE status = 'active'
       AND ($1::text IS NULL OR provider = $1)
     ORDER BY created_at DESC
     LIMIT 20`,
    [provider || null]
  );
  return result.rows;
}

export async function resolveWhatsAppAccountForInbound(
  message?: Pick<NormalizedWhatsAppMessage, "provider" | "to"> | null
) {
  const provider = message?.provider || null;
  const accounts = await listActiveWhatsAppAccounts(provider);
  if (accounts.length === 0) {
    return null;
  }

  const rawRecipient = message?.to?.trim() ?? "";
  const recipientDigits = normalizeDigits(rawRecipient);
  if (rawRecipient) {
    const matches = accounts.filter((account) => {
      const accountDigits = normalizeDigits(account.phone_number);
      return (
        account.phone_number === rawRecipient ||
        (recipientDigits.length > 0 && accountDigits === recipientDigits) ||
        account.waba_id === rawRecipient
      );
    });
    if (matches.length === 1) {
      return matches[0];
    }
    if (matches.length > 1) {
      throw new Error("Ambiguous WhatsApp recipient account.");
    }
    if (accounts.length > 1) {
      throw new Error("No active WhatsApp account matches the webhook recipient.");
    }
  }

  if (accounts.length === 1) {
    return accounts[0];
  }

  throw new Error("Unable to resolve WhatsApp tenant for inbound webhook.");
}

function getAccountAccessToken(record: WhatsAppInboundAccount) {
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

async function resolveWhatsAppTicketId(conversationId: string, tenantId: string) {
  const result = await db.query<{ ticket_id: string }>(
    `SELECT ticket_id
     FROM messages
     WHERE channel = 'whatsapp'
       AND conversation_id = $1
       AND tenant_id = $2
       AND ticket_id IS NOT NULL
     ORDER BY created_at DESC
     LIMIT 1`,
    [conversationId, tenantId]
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

  const account = await resolveWhatsAppAccountForInbound(message);
  if (!account) {
    throw new Error("No active WhatsApp account configured for inbound webhook.");
  }
  const tenantId = account.tenant_id;

  // ── Idempotency check (outside transaction, read-only) ──
  if (message.messageId) {
    const existing = await db.query(
      `SELECT id, ticket_id
       FROM messages
       WHERE channel = 'whatsapp'
         AND external_message_id = $1
         AND tenant_id = $2
       LIMIT 1`,
      [message.messageId, tenantId]
    );
    if ((existing.rowCount ?? 0) > 0) {
      return {
        status: "duplicate",
        messageId: existing.rows[0].id,
        ticketId: existing.rows[0].ticket_id ?? null
      };
    }
  }

  // ── Phase 1: Resolve all external/network data BEFORE the transaction ──
  const requesterProfile = await lookupPredictionProfile({ phone: from });
  const customerResolution = await resolveOrCreateCustomerForInbound({
    tenantId,
    profile: requesterProfile.status === "matched" ? requesterProfile.profile : null,
    inboundPhone: from,
    displayName: message.contactName ?? null
  });
  const profileMetadataPatch =
    requesterProfile.status === "matched" && customerResolution?.conflict
      ? applyIdentityConflictMetadata(
          buildProfileMetadataPatch(requesterProfile),
          customerResolution.conflict
        )
      : buildProfileMetadataPatch(requesterProfile);

  const mailbox = await getOrCreateMailbox(supportAddress, supportAddress, tenantId);
  if (mailbox.tenant_id !== tenantId) {
    throw new Error("WhatsApp support mailbox belongs to another tenant.");
  }
  const conversationId = message.conversationId ?? from;

  const existingTicketId: string | null = await resolveWhatsAppTicketId(conversationId, tenantId);

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

  // Pre-compute tag inference (pure function, no DB)
  const inferredTags = !existingTicketId
    ? inferTagsFromText({ subject: null, text: message.text ?? null })
    : [];

  // Download all media from Meta Graph API BEFORE starting the transaction.
  // This isolates network failures from database state mutations.
  type ResolvedAttachment = {
    attachmentId: string;
    safeFilename: string;
    buffer: Buffer;
    contentType: string | null;
    size: number;
    originalFilename: string | null;
  };
  const resolvedAttachments: ResolvedAttachment[] = [];

  if (attachments.length) {
    const accessToken = getAccountAccessToken(account);
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

      resolvedAttachments.push({
        attachmentId,
        safeFilename,
        buffer,
        contentType,
        size: size ?? buffer.length,
        originalFilename: attachment.filename ?? null
      });
    }
  }

  const messageId = randomUUID();
  const receivedAt = parseTimestamp(message.timestamp);

  // ── Phase 2: Atomic database transaction ──
  // All database mutations happen inside a single transaction so that
  // a failure at any point rolls back cleanly — no ghost tickets.
  let ticketId = existingTicketId;
  let createdNewTicket = false;
  let attachedCustomerToTicket = false;

  const client = await db.connect();
  try {
    await client.query("BEGIN");

    if (!ticketId) {
      const category = inferredTags[0]?.toLowerCase() ?? null;
      const metadata = {
        channel: "whatsapp",
        wa_contact: from,
        provider: message.provider ?? account.provider,
        contact_name: message.contactName ?? null,
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
          formatRequester(from),
          subject,
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
        // Batch-insert tags in a single pass instead of looping individual queries
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

      if (requesterProfile.status === "matched") {
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

    if (requesterProfile.status === "matched" && ticketId && !customerResolution?.conflict) {
      await upsertExternalUserLink({
        externalSystem: "prediction-market-mvp",
        profile: requesterProfile.profile,
        matchedBy: requesterProfile.matchedBy,
        inboundPhone: from,
        ticketId,
        channel: "whatsapp",
        queryExecutor: client
      });
    }

    if (createdNewTicket && requesterProfile.status === "matched" && !customerResolution?.conflict) {
      await client.query(
        `INSERT INTO ticket_events (tenant_id, ticket_id, event_type, actor_user_id, data)
         VALUES ($1, $2, $3, $4, $5)`,
        [tenantId, ticketId, "profile_enriched", null, {
          source: "prediction-market-mvp",
          matchedBy: requesterProfile.matchedBy,
          externalUserId: requesterProfile.profile.id
        }]
      );
    } else if (ticketId && requesterProfile.status === "matched" && customerResolution?.conflict) {
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

    // Insert the message row
    await client.query(
      `INSERT INTO messages (
        tenant_id, id, mailbox_id, ticket_id, direction, channel, message_id, thread_id,
        external_message_id, conversation_id, wa_contact, wa_status, wa_timestamp, provider,
        from_email, to_emails, subject, preview_text, received_at, is_read
      ) VALUES (
        $1, $2, $3, $4, 'inbound', 'whatsapp', $5, $6,
        $7, $8, $9, $10, $11, $12,
        $13, $14, $15, $16, $17, false
      )`,
      [
        tenantId,
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
        message.provider ?? account.provider,
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

    await client.query(
      `INSERT INTO whatsapp_status_events (tenant_id, message_id, external_message_id, status, occurred_at, payload)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        tenantId,
        messageId,
        message.messageId ?? null,
        "received",
        receivedAt,
        { source: "inbound", status: "received" }
      ]
    );

    // Insert attachment metadata rows (media buffers already downloaded)
    for (const resolved of resolvedAttachments) {
      const r2Key = `messages/${messageId}/attachments/${resolved.attachmentId}-${resolved.safeFilename}`;
      await client.query(
        `INSERT INTO attachments (tenant_id, id, message_id, filename, content_type, size_bytes, r2_key)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          tenantId,
          resolved.attachmentId,
          messageId,
          resolved.originalFilename ?? resolved.safeFilename,
          resolved.contentType ?? null,
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
  let textKey: string | null = null;
  let sizeBytes = 0;
  const failedStorageItems: Array<{ kind: string; target: string; detail: string }> = [];

  if (message.text || fallbackCaption) {
    try {
      const bodyText = message.text ?? fallbackCaption ?? "";
      textKey = await putObject({
        key: `messages/${messageId}/body.txt`,
        body: bodyText,
        contentType: "text/plain; charset=utf-8"
      });
      sizeBytes += Buffer.byteLength(bodyText);
    } catch (error) {
      failedStorageItems.push({
        kind: "text",
        target: `messages/${messageId}/body.txt`,
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
        target: resolved.originalFilename ?? resolved.safeFilename,
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

  if (textKey || sizeBytes) {
    await db.query(
      `UPDATE messages
       SET r2_key_text = $1, size_bytes = $2
       WHERE id = $3
         AND tenant_id = $4`,
      [textKey, sizeBytes || null, messageId, tenantId]
    );
  }

  if (ticketId) {
    const messageEvent = buildAgentEvent({
      eventType: "ticket.message.created",
      ticketId,
      messageId,
      mailboxId: mailbox.id,
      tenantId,
      excerpt: previewText,
      threadId: conversationId
    });
    await enqueueAgentEvent({ eventType: "ticket.message.created", payload: messageEvent, tenantId });

    if (createdNewTicket) {
      const ticketEvent = buildAgentEvent({
        eventType: "ticket.created",
        ticketId,
        mailboxId: mailbox.id,
        tenantId,
        excerpt: previewText,
        threadId: conversationId
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
        threadId: conversationId
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
            email: null,
            phone: from
          },
          matchedByProfile: requesterProfile.status === "matched",
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
