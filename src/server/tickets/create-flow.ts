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
import { buildAgentEvent } from "@/server/agents/events";
import { deliverPendingAgentEvents, enqueueAgentEvent } from "@/server/agents/outbox";
import {
  resolveOrCreateCustomerForInbound,
  type CustomerResolutionConflict
} from "@/server/customers";
import {
  buildExternalProfileMetadataPatch,
  enrichExternalProfileMetadata,
  lookupExternalProfile,
  readExternalProfileFromMetadata,
  readExternalProfileMatchedBy,
  readExternalProfileSource
} from "@/server/integrations/external-profile";
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
import {
  integrationError,
  integrationSuccess
} from "@/server/api-contract";
import { runInBackground } from "@/server/async";
import type { SessionUser } from "@/server/auth/session";

export const createTicketSchema = z.object({
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

export type CreateTicketPayload = z.infer<typeof createTicketSchema>;

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

function moduleDisabledResponse(request: Request, module: "email" | "whatsapp" | "voice") {
  const label = module === "voice" ? "Voice" : module === "whatsapp" ? "WhatsApp" : "Email";
  return integrationError(request, {
    status: 409,
    code: "module_disabled",
    message: `${label} module is not enabled for this workspace.`,
    extra: { module }
  });
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
  tenantId,
  fromEmail,
  metadata
}: {
  tenantId: string;
  fromEmail: string;
  metadata: Record<string, unknown> | null;
}) {
  const enriched = enrichExternalProfileMetadata(metadata);
  if (readExternalProfileFromMetadata(enriched)) {
    return enriched;
  }

  const lookup = await lookupExternalProfile({
    tenantId,
    email: fromEmail,
    phone: readLookupPhoneFromMetadata(enriched) ?? undefined
  });
  return {
    ...(enriched ?? {}),
    ...buildExternalProfileMetadataPatch(lookup)
  } as Record<string, unknown>;
}

export async function processCreateTicket({
  request,
  sessionUser,
  tenantId,
  data
}: {
  request: Request;
  sessionUser: SessionUser | null;
  tenantId: string;
  data: CreateTicketPayload;
}) {
  const supportAddress = getSupportAddress();
  if (!supportAddress) {
    return integrationError(request, {
      status: 500,
      code: "support_address_not_configured",
      message: "Support address not configured"
    });
  }

  const mailbox = await getOrCreateMailbox(supportAddress, supportAddress, tenantId);
  if (mailbox.tenant_id !== tenantId) {
    return integrationError(request, {
      status: 500,
      code: "support_mailbox_tenant_mismatch",
      message: "Support mailbox belongs to another tenant"
    });
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
    return moduleDisabledResponse(request, "voice");
  }
  if (contactMode === "whatsapp" && !(await checkModuleEntitlement("whatsapp", tenantId))) {
    return moduleDisabledResponse(request, "whatsapp");
  }
  if (contactMode === "email" && !(await checkModuleEntitlement("email", tenantId))) {
    return moduleDisabledResponse(request, "email");
  }

  // Support agents creating tickets from CRM send outbound first contact.
  if (sessionUser) {
    if (contactMode === "call") {
      const toPhone = normalizeCallPhone(data.toPhone ?? null);
      if (!toPhone) {
        return integrationError(request, {
          status: 400,
          code: "invalid_destination_phone",
          message: "Valid destination phone number is required"
        });
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
        tenantId,
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
        tenantId,
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
        return integrationError(request, {
          status: 403,
          code: policyCheck.code ?? "call_policy_blocked",
          message: "Outbound call blocked by voice policy.",
          detail: policyCheck.detail,
          extra: {
            status: "blocked",
            errorCode: policyCheck.code
          }
        });
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
        await addTagsToTicket(tenantId, ticketId, inferredTags);
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
      runInBackground(deliverPendingCallEvents({ limit: 5, tenantId }), "Call outbox delivery failed", {
        route: "/api/tickets/create",
        tenantId,
        channel: "voice",
        ticketId
      });

      const ticketEvent = buildAgentEvent({
        eventType: "ticket.created",
        ticketId,
        mailboxId: mailbox.id,
        tenantId,
        excerpt: previewText || data.subject,
        threadId: queuedCall.callSessionId
      });
      await enqueueAgentEvent({ eventType: "ticket.created", payload: ticketEvent, tenantId });
      runInBackground(deliverPendingAgentEvents({ tenantId }), "Agent outbox delivery failed", {
        route: "/api/tickets/create",
        tenantId,
        channel: "voice",
        ticketId
      });

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

      return integrationSuccess(
        request,
        {
          status: "created",
          ticketId,
          messageId: queuedCall.messageId,
          callSessionId: queuedCall.callSessionId,
          channel: "voice"
        }
      );
    }

    if (contactMode === "whatsapp") {
      const toPhone = normalizeCallPhone(data.toPhone ?? null);
      if (!toPhone) {
        return integrationError(request, {
          status: 400,
          code: "invalid_whatsapp_phone",
          message: "Valid WhatsApp phone number is required"
        });
      }
      if (!descriptionText && !(data.attachments?.length ?? 0)) {
        return integrationError(request, {
          status: 400,
          code: "missing_whatsapp_content",
          message: "WhatsApp message or attachment is required"
        });
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
        tenantId,
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
        await addTagsToTicket(tenantId, ticketId, inferredTags);
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

      runInBackground(deliverPendingAgentEvents({ tenantId }), "Agent outbox delivery failed", {
        route: "/api/tickets/create",
        tenantId,
        channel: "whatsapp",
        ticketId
      });
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
      return integrationSuccess(
        request,
        {
          status: "created",
          ticketId,
          messageId: queuedMessage.messageId ?? null,
          channel: "whatsapp"
        }
      );
    }

    const toEmail = normalizeAddressList(data.to ?? data.from ?? "")[0];
    if (!toEmail) {
      return integrationError(request, {
        status: 400,
        code: "missing_email_to",
        message: "Email to is required"
      });
    }
    if (!descriptionText) {
      return integrationError(request, {
        status: 400,
        code: "missing_description",
        message: "Description is required"
      });
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
    return integrationSuccess(request, { status: "created", ticketId, messageId });
  }

  // External platform callers create inbound tickets (end-user initiated).
  if (contactMode !== "email") {
    return integrationError(request, {
      status: 400,
      code: "unsupported_external_contact_mode",
      message: "Only email ticket creation is supported for external callers"
    });
  }
  const fromEmail = normalizeAddressList(data.from ?? data.to ?? "")[0];
  if (!fromEmail) {
    return integrationError(request, {
      status: 400,
      code: "invalid_sender_address",
      message: "Invalid sender address"
    });
  }
  if (!descriptionText) {
    return integrationError(request, {
      status: 400,
      code: "missing_description",
      message: "Description is required"
    });
  }
  let enrichedMetadata = await enrichInboundExternalMetadata({
    tenantId,
    fromEmail,
    metadata: (data.metadata as Record<string, unknown> | null) ?? null
  });
  const resolvedProfile = readExternalProfileFromMetadata(enrichedMetadata);
  const externalProfileSource = readExternalProfileSource(enrichedMetadata);
  const customerResolution = await resolveOrCreateCustomerForInbound({
    tenantId,
    externalSystem: externalProfileSource,
    profile: resolvedProfile,
    inboundEmail: fromEmail
  });
  if (customerResolution?.conflict) {
    enrichedMetadata = applyIdentityConflictMetadata(enrichedMetadata, customerResolution.conflict);
  }
  await syncVoiceConsentFromMetadata({
    tenantId,
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
    await addTagsToTicket(tenantId, ticketId, inferredTags);
    await recordTicketEvent({
      tenantId,
      ticketId,
      eventType: "tags_assigned",
      data: { tags: inferredTags }
    });
  }

  if (resolvedProfile && !customerResolution?.conflict) {
    const matchedBy = readExternalProfileMatchedBy(enrichedMetadata);
    await upsertExternalUserLink({
      tenantId,
      externalSystem: externalProfileSource,
      profile: resolvedProfile,
      matchedBy,
      inboundEmail: fromEmail,
      ticketId,
      channel: "email"
    });
    await recordTicketEvent({
      tenantId,
      ticketId,
      eventType: "profile_enriched",
      data: {
        source: externalProfileSource,
        matchedBy,
        externalUserId: resolvedProfile.id
      }
    });
  } else if (resolvedProfile && customerResolution?.conflict) {
    const matchedBy = readExternalProfileMatchedBy(enrichedMetadata);
    await recordTicketEvent({
      tenantId,
      ticketId,
      eventType: "customer_identity_conflict",
      data: {
        source: externalProfileSource,
        matchedBy,
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
        `INSERT INTO attachments (tenant_id, id, message_id, filename, content_type, size_bytes, r2_key)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          tenantId,
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
  runInBackground(deliverPendingAgentEvents({ tenantId }), "Agent outbox delivery failed", {
    route: "/api/tickets/create",
    tenantId,
    channel: "email",
    ticketId
  });

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

  return integrationSuccess(request, { status: "created", ticketId, messageId });
}
