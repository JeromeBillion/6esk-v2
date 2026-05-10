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
import {
  resolveOrCreateCustomerForInbound,
  type CustomerResolutionConflict
} from "@/server/customers";
import {
  buildProfileMetadataPatch,
  lookupPredictionProfile,
  type PredictionProfile
} from "@/server/integrations/prediction-profile";
import { upsertExternalUserLink } from "@/server/integrations/external-user-links";
import { normalizeCallPhone, queueOutboundCall } from "@/server/calls/service";
import { deliverPendingCallEvents } from "@/server/calls/outbox";
import {
  getLatestVoiceConsentState,
  syncVoiceConsentFromMetadata
} from "@/server/calls/consent";
import {
  evaluateVoiceCallPolicy,
  getHumanVoicePolicyFromEnv
} from "@/server/calls/policy";
import { queueWhatsAppSend } from "@/server/whatsapp/send";
import { createOutboundEmailTicket } from "@/server/tickets/outbound-email";
import { checkModuleEntitlement } from "@/server/tenant/module-guard";
import { recordModuleUsageEvent } from "@/server/module-metering";
import { DEFAULT_TENANT_ID } from "@/server/tenant/types";

const createTicketSchema = z.object({
  contactMode: z.enum(["email", "whatsapp", "call"]).optional(),
  to: z.string().email().optional(),
  from: z.string().email().optional(),
  toPhone: z.string().optional().nullable(),
  subject: z.string().min(1),
  description: z.string().optional().nullable(),
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

function moduleDisabledResponse(module: "email" | "whatsapp" | "voice") {
  const label = module === "voice" ? "Voice" : module === "whatsapp" ? "WhatsApp" : "Email";
  return Response.json(
    {
      error: `${label} module is not enabled for this workspace.`,
      code: "module_disabled",
      module
    },
    { status: 409 }
  );
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

function readProfileFromMetadata(
  metadata: Record<string, unknown> | null
): PredictionProfile | null {
  if (!metadata) return null;
  const payload = metadata.external_profile;
  if (!payload || typeof payload !== "object") return null;
  const profile = payload as Record<string, unknown>;

  const id = readString(profile.externalUserId);
  const email = readString(profile.email);
  if (!id || !email) {
    return null;
  }

  return {
    id,
    email,
    secondaryEmail: readString(profile.secondaryEmail),
    fullName: readString(profile.fullName),
    phoneNumber: readString(profile.phoneNumber),
    kycStatus: readString(profile.kycStatus),
    accountStatus: readString(profile.accountStatus)
  };
}

function readLookupPhoneFromMetadata(metadata: Record<string, unknown> | null) {
  if (!metadata) return null;

  const directPhone =
    readString(metadata.appUserPhone) ??
    readString(metadata.phoneNumber) ??
    readString(metadata.phone);
  if (directPhone) {
    return directPhone;
  }

  const externalProfile =
    typeof metadata.external_profile === "object" && metadata.external_profile !== null
      ? (metadata.external_profile as Record<string, unknown>)
      : null;

  return (
    readString(externalProfile?.phoneNumber) ??
    readString(externalProfile?.phone) ??
    null
  );
}

function readLookupMatchedByFromMetadata(metadata: Record<string, unknown> | null) {
  if (!metadata) return null;
  const payload =
    typeof metadata.profile_lookup === "object" && metadata.profile_lookup !== null
      ? (metadata.profile_lookup as Record<string, unknown>)
      : null;
  return readString(payload?.matchedBy);
}

function applyIdentityConflictMetadata(
  metadata: Record<string, unknown> | null,
  conflict: CustomerResolutionConflict
) {
  const next = { ...(metadata ?? {}) } as Record<string, unknown>;
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

async function enrichInboundExternalMetadata({
  fromEmail,
  metadata
}: {
  fromEmail: string;
  metadata: Record<string, unknown> | null;
}) {
  const enriched = enrichExternalProfileMetadata(metadata);
  if (readProfileFromMetadata(enriched)) {
    return enriched;
  }

  const lookup = await lookupPredictionProfile({
    email: fromEmail,
    phone: readLookupPhoneFromMetadata(enriched) ?? undefined
  });
  return {
    ...(enriched ?? {}),
    ...buildProfileMetadataPatch(lookup)
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
  const tenantId = sessionUser?.tenant_id ?? DEFAULT_TENANT_ID;

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

  const mailbox = await getOrCreateMailbox(supportAddress, supportAddress, tenantId);
  if (mailbox.tenant_id !== tenantId) {
    return Response.json({ error: "Support mailbox belongs to another tenant" }, { status: 500 });
  }
  const inferredTags = data.tags?.length
    ? data.tags
    : inferTagsFromText({ subject: data.subject, text: data.description ?? null });
  const category =
    data.category?.toLowerCase().trim() ?? inferredTags[0]?.toLowerCase() ?? null;
  const descriptionText = data.description?.replace(/\s+/g, " ").trim() ?? "";
  const previewText = descriptionText.slice(0, 200);
  const contactMode =
    data.contactMode === "call"
      ? "call"
      : data.contactMode === "whatsapp"
        ? "whatsapp"
        : "email";

  if (contactMode === "call" && !(await checkModuleEntitlement("voice", tenantId))) {
    return moduleDisabledResponse("voice");
  }
  if (contactMode === "whatsapp" && !(await checkModuleEntitlement("whatsapp", tenantId))) {
    return moduleDisabledResponse("whatsapp");
  }
  if (contactMode === "email" && !(await checkModuleEntitlement("email", tenantId))) {
    return moduleDisabledResponse("email");
  }

  // Support agents creating tickets from CRM send outbound first contact.
  if (sessionUser) {
    if (contactMode === "call") {
      const toPhone = normalizeCallPhone(data.toPhone ?? null);
      if (!toPhone) {
        return Response.json({ error: "Valid destination phone number is required" }, { status: 400 });
      }

      const callTicketMetadata = {
        source: "manual_outbound_call",
        createdByUserId: sessionUser.id,
        toPhone,
        ...(data.metadata ?? {})
      } as Record<string, unknown>;

      const customerResolution = await resolveOrCreateCustomerForInbound({
        tenantId,
        inboundPhone: toPhone
      });
      await syncVoiceConsentFromMetadata({
        metadata: callTicketMetadata,
        customerId: customerResolution?.customerId ?? null,
        fallbackPhone: toPhone,
        defaultSource: "manual_outbound_call",
        consentTermsVersion: process.env.CALLS_CONSENT_TERMS_VERSION ?? null,
        context: {
          route: "/api/tickets/create",
          contactMode: "call",
          actorUserId: sessionUser.id
        }
      });
      const consentState = await getLatestVoiceConsentState({
        customerId: customerResolution?.customerId ?? null,
        phone: toPhone
      });

      const maxCallsPerHour = Number(process.env.RATE_LIMIT_CALLS_OUTBOUND ?? "0");
      const policyCheck = await evaluateVoiceCallPolicy({
        actor: "human",
        policy: getHumanVoicePolicyFromEnv(),
        ticketMetadata: callTicketMetadata,
        consentState,
        selectedCandidateId: null,
        actorUserId: sessionUser.id,
        defaultMaxCallsPerHour: Number.isFinite(maxCallsPerHour) ? maxCallsPerHour : null
      });
      if (!policyCheck.allowed) {
        return Response.json(
          {
            status: "blocked",
            errorCode: policyCheck.code,
            detail: policyCheck.detail
          },
          { status: 403 }
        );
      }

      const ticketId = await createTicket({
        tenantId,
        mailboxId: mailbox.id,
        customerId: customerResolution?.customerId ?? null,
        requesterEmail: `voice:${toPhone}`,
        subject: data.subject,
        category,
        metadata: callTicketMetadata
      });

      await recordTicketEvent({
        tenantId,
        ticketId,
        eventType: "ticket_created",
        actorUserId: sessionUser.id
      });

      if (inferredTags.length) {
        await addTagsToTicket(ticketId, inferredTags);
        await recordTicketEvent({
          tenantId,
          ticketId,
          eventType: "tags_assigned",
          actorUserId: sessionUser.id,
          data: { tags: inferredTags }
        });
      }

      const queuedCall = await queueOutboundCall({
        ticketId,
        tenantId,
        toPhone,
        reason: descriptionText || data.subject,
        origin: "human",
        actorUserId: sessionUser.id,
        metadata: data.metadata ?? null
      });
      void deliverPendingCallEvents({ limit: 5 }).catch(() => {});

      const ticketEvent = buildAgentEvent({
        eventType: "ticket.created",
        ticketId,
        mailboxId: mailbox.id,
        tenantId,
        excerpt: previewText || data.subject,
        threadId: queuedCall.callSessionId
      });
      await enqueueAgentEvent({ eventType: "ticket.created", payload: ticketEvent, tenantId });
      void deliverPendingAgentEvents({ tenantId }).catch(() => {});

      await recordModuleUsageEvent({
        tenantId,
        moduleKey: "voice",
        usageKind: "ticket_created_outbound",
        actorType: "human",
        metadata: {
          route: "/api/tickets/create",
          ticketId,
          callSessionId: queuedCall.callSessionId,
          messageId: queuedCall.messageId,
          contactMode: "call"
        }
      });

      return Response.json({
        status: "created",
        ticketId,
        messageId: queuedCall.messageId,
        callSessionId: queuedCall.callSessionId,
        channel: "voice"
      });
    }

    if (contactMode === "whatsapp") {
      const toPhone = normalizeCallPhone(data.toPhone ?? null);
      if (!toPhone) {
        return Response.json({ error: "Valid WhatsApp phone number is required" }, { status: 400 });
      }
      if (!descriptionText && !(data.attachments?.length ?? 0)) {
        return Response.json(
          { error: "WhatsApp message or attachment is required" },
          { status: 400 }
        );
      }

      const customerResolution = await resolveOrCreateCustomerForInbound({
        tenantId,
        inboundPhone: toPhone
      });
      const whatsappTicketMetadata = {
        source: "manual_outbound_whatsapp",
        createdByUserId: sessionUser.id,
        toPhone,
        ...(data.metadata ?? {})
      } as Record<string, unknown>;
      await syncVoiceConsentFromMetadata({
        metadata: whatsappTicketMetadata,
        customerId: customerResolution?.customerId ?? null,
        fallbackPhone: toPhone,
        defaultSource: "manual_outbound_whatsapp",
        consentTermsVersion: process.env.CALLS_CONSENT_TERMS_VERSION ?? null,
        context: {
          route: "/api/tickets/create",
          contactMode: "whatsapp",
          actorUserId: sessionUser.id
        }
      });

      const ticketId = await createTicket({
        tenantId,
        mailboxId: mailbox.id,
        customerId: customerResolution?.customerId ?? null,
        requesterEmail: `whatsapp:${toPhone}`,
        subject: data.subject,
        category,
        metadata: whatsappTicketMetadata
      });

      await recordTicketEvent({
        tenantId,
        ticketId,
        eventType: "ticket_created",
        actorUserId: sessionUser.id
      });

      if (inferredTags.length) {
        await addTagsToTicket(ticketId, inferredTags);
        await recordTicketEvent({
          tenantId,
          ticketId,
          eventType: "tags_assigned",
          actorUserId: sessionUser.id,
          data: { tags: inferredTags }
        });
      }

      const queuedMessage = await queueWhatsAppSend({
        tenantId,
        ticketId,
        to: toPhone,
        text: descriptionText || undefined,
        attachments: data.attachments ?? null,
        actorUserId: sessionUser.id,
        origin: "human"
      });

      const threadId = queuedMessage.messageId ?? null;
      const ticketEvent = buildAgentEvent({
        eventType: "ticket.created",
        ticketId,
        mailboxId: mailbox.id,
        tenantId,
        excerpt: previewText || data.subject,
        threadId
      });
      await enqueueAgentEvent({ eventType: "ticket.created", payload: ticketEvent, tenantId });

      if (queuedMessage.messageId) {
        const messageEvent = buildAgentEvent({
          eventType: "ticket.message.created",
          ticketId,
          messageId: queuedMessage.messageId,
          mailboxId: mailbox.id,
          tenantId,
          excerpt: previewText || data.subject,
          threadId
        });
        await enqueueAgentEvent({ eventType: "ticket.message.created", payload: messageEvent, tenantId });
      }

      void deliverPendingAgentEvents({ tenantId }).catch(() => {});
      await recordModuleUsageEvent({
        tenantId,
        moduleKey: "whatsapp",
        usageKind: "ticket_created_outbound",
        actorType: "human",
        metadata: {
          route: "/api/tickets/create",
          ticketId,
          messageId: queuedMessage.messageId ?? null,
          contactMode: "whatsapp"
        }
      });
      return Response.json({
        status: "created",
        ticketId,
        messageId: queuedMessage.messageId ?? null,
        channel: "whatsapp"
      });
    }

    const toEmail = normalizeAddressList(data.to ?? data.from ?? "")[0];
    if (!toEmail) {
      return Response.json({ error: "Email to is required" }, { status: 400 });
    }
    if (!descriptionText) {
      return Response.json({ error: "Description is required" }, { status: 400 });
    }
    const emailTicketMetadata = {
      source: "manual_outbound",
      createdByUserId: sessionUser.id,
      ...(data.metadata ?? {})
    } as Record<string, unknown>;
    const created = await createOutboundEmailTicket({
      tenantId,
      actorUserId: sessionUser.id,
      toEmail,
      subject: data.subject,
      text: descriptionText,
      html: data.descriptionHtml ?? null,
      category,
      tags: inferredTags,
      metadata: emailTicketMetadata,
      attachments: data.attachments ?? null,
      contextRoute: "/api/tickets/create"
    });

    const ticketId = created.ticketId;
    const messageId = created.messageId;
    await recordModuleUsageEvent({
      tenantId,
      moduleKey: "email",
      usageKind: "ticket_created_outbound",
      actorType: "human",
      metadata: {
        route: "/api/tickets/create",
        ticketId,
        messageId,
        contactMode: "email"
      }
    });
    return Response.json({ status: "created", ticketId, messageId });
  }

  // External platform callers create inbound tickets (end-user initiated).
  if (contactMode !== "email") {
    return Response.json(
      { error: "Only email ticket creation is supported for external callers" },
      { status: 400 }
    );
  }
  const fromEmail = normalizeAddressList(data.from ?? data.to ?? "")[0];
  if (!fromEmail) {
    return Response.json({ error: "Invalid sender address" }, { status: 400 });
  }
  if (!descriptionText) {
    return Response.json({ error: "Description is required" }, { status: 400 });
  }
  let enrichedMetadata = await enrichInboundExternalMetadata({
    fromEmail,
    metadata: (data.metadata as Record<string, unknown> | null) ?? null
  });
  const resolvedProfile = readProfileFromMetadata(enrichedMetadata);
  const customerResolution = await resolveOrCreateCustomerForInbound({
    tenantId,
    profile: resolvedProfile,
    inboundEmail: fromEmail
  });
  if (customerResolution?.conflict) {
    enrichedMetadata = applyIdentityConflictMetadata(enrichedMetadata, customerResolution.conflict);
  }
  await syncVoiceConsentFromMetadata({
    metadata: enrichedMetadata,
    customerId: customerResolution?.customerId ?? null,
    fallbackEmail: fromEmail,
    defaultSource: "external_ticket_create",
    consentTermsVersion: process.env.CALLS_CONSENT_TERMS_VERSION ?? null,
    context: {
      route: "/api/tickets/create",
      contactMode: "email",
      source: "external_platform"
    }
  });

  const ticketId = await createTicket({
    tenantId,
    mailboxId: mailbox.id,
    customerId: customerResolution?.customerId ?? null,
    requesterEmail: fromEmail,
    subject: data.subject,
    category,
    metadata: enrichedMetadata
  });

  await recordTicketEvent({ tenantId, ticketId, eventType: "ticket_created" });

  if (inferredTags.length) {
    await addTagsToTicket(ticketId, inferredTags);
    await recordTicketEvent({
      tenantId,
      ticketId,
      eventType: "tags_assigned",
      data: { tags: inferredTags }
    });
  }

  if (resolvedProfile && !customerResolution?.conflict) {
    await upsertExternalUserLink({
      externalSystem: "prediction-market-mvp",
      profile: resolvedProfile,
      matchedBy: readLookupMatchedByFromMetadata(enrichedMetadata),
      inboundEmail: fromEmail,
      ticketId,
      channel: "email"
    });
    await recordTicketEvent({
      tenantId,
      ticketId,
      eventType: "profile_enriched",
      data: {
        source: "prediction-market-mvp",
        matchedBy: readLookupMatchedByFromMetadata(enrichedMetadata),
        externalUserId: resolvedProfile.id
      }
    });
  } else if (resolvedProfile && customerResolution?.conflict) {
    await recordTicketEvent({
      tenantId,
      ticketId,
      eventType: "customer_identity_conflict",
      data: {
        source: "prediction-market-mvp",
        matchedBy: readLookupMatchedByFromMetadata(enrichedMetadata),
        conflict: customerResolution.conflict
      }
    });
  }

  const messageId = randomUUID();
  const receivedAt = new Date();

  await db.query(
    `INSERT INTO messages (
      tenant_id, id, mailbox_id, ticket_id, direction, message_id, thread_id, from_email,
      to_emails, subject, preview_text, received_at, is_read
    ) VALUES (
      $1, $2, $3, $4, 'inbound', $5, $6, $7,
      $8, $9, $10, $11, false
    )`,
    [
      tenantId,
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
    body: descriptionText,
    contentType: "text/plain; charset=utf-8"
  });
  sizeBytes += Buffer.byteLength(descriptionText);

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

  if (customerResolution?.customerId) {
    const identityEvent = buildAgentEvent({
      eventType: "customer.identity.resolved",
      ticketId,
      mailboxId: mailbox.id,
      tenantId,
      excerpt: `Resolved customer ${customerResolution.customerId}`,
      threadId: messageId
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
          phone: readLookupPhoneFromMetadata(enrichedMetadata)
        },
        matchedByProfile: Boolean(resolvedProfile),
        ...(customerResolution.conflict ? { conflict: customerResolution.conflict } : {})
      }
    });
  }

  await recordTicketEvent({ tenantId, ticketId, eventType: "message_received" });

  const threadId = messageId;
  const messageEvent = buildAgentEvent({
    eventType: "ticket.message.created",
    ticketId,
    messageId,
    mailboxId: mailbox.id,
    tenantId,
    excerpt: previewText,
    threadId
  });
  const ticketEvent = buildAgentEvent({
    eventType: "ticket.created",
    ticketId,
    mailboxId: mailbox.id,
    tenantId,
    excerpt: previewText,
    threadId
  });

  await enqueueAgentEvent({ eventType: "ticket.message.created", payload: messageEvent, tenantId });
  await enqueueAgentEvent({ eventType: "ticket.created", payload: ticketEvent, tenantId });
  void deliverPendingAgentEvents({ tenantId }).catch(() => {});

  await recordModuleUsageEvent({
    tenantId,
    moduleKey: "email",
    usageKind: "ticket_created_inbound",
    actorType: "system",
    metadata: {
      route: "/api/tickets/create",
      ticketId,
      messageId,
      source: "external_platform"
    }
  });

  return Response.json({ status: "created", ticketId, messageId });
}
