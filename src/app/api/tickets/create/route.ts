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
  enrichExternalProfileMetadata,
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
import { isWorkspaceModuleEnabled } from "@/server/workspace-modules";
import { recordModuleUsageEvent } from "@/server/module-metering";
import {
  isTenantIngressScopeError,
  tenantScopeFromMachineRequestAsync,
  tenantScopeFromUser
} from "@/server/tenant-context";

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
  metadata
}: {
  metadata: Record<string, unknown> | null;
}) {
  return enrichExternalProfileMetadata(metadata);
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
  let scope;
  try {
    scope = sessionUser ? tenantScopeFromUser(sessionUser) : await tenantScopeFromMachineRequestAsync(request);
  } catch (error) {
    if (isTenantIngressScopeError(error)) {
      return Response.json({ error: error.message, code: error.code }, { status: error.status });
    }
    throw error;
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

  const mailbox = await getOrCreateMailbox(supportAddress, supportAddress, scope);
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

  if (contactMode === "call" && !(await isWorkspaceModuleEnabled("voice", scope.workspaceKey, scope.tenantKey))) {
    return moduleDisabledResponse("voice");
  }
  if (contactMode === "whatsapp" && !(await isWorkspaceModuleEnabled("whatsapp", scope.workspaceKey, scope.tenantKey))) {
    return moduleDisabledResponse("whatsapp");
  }
  if (contactMode === "email" && !(await isWorkspaceModuleEnabled("email", scope.workspaceKey, scope.tenantKey))) {
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
        tenantKey: scope.tenantKey,
        workspaceKey: scope.workspaceKey,
        inboundPhone: toPhone
      });
      await syncVoiceConsentFromMetadata({
        tenantKey: scope.tenantKey,
        workspaceKey: scope.workspaceKey,
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
        tenantKey: scope.tenantKey,
        workspaceKey: scope.workspaceKey,
        customerId: customerResolution?.customerId ?? null,
        phone: toPhone
      });

      const maxCallsPerHour = Number(process.env.RATE_LIMIT_CALLS_OUTBOUND ?? "0");
      const policyCheck = await evaluateVoiceCallPolicy({
        tenantKey: scope.tenantKey,
        workspaceKey: scope.workspaceKey,
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
        tenantKey: scope.tenantKey,
        workspaceKey: scope.workspaceKey,
        mailboxId: mailbox.id,
        customerId: customerResolution?.customerId ?? null,
        requesterEmail: `voice:${toPhone}`,
        subject: data.subject,
        category,
        metadata: callTicketMetadata
      });

      await recordTicketEvent({
        ticketId,
        eventType: "ticket_created",
        actorUserId: sessionUser.id,
        tenantKey: scope.tenantKey,
        workspaceKey: scope.workspaceKey
      });

      if (inferredTags.length) {
        await addTagsToTicket(ticketId, inferredTags, scope);
        await recordTicketEvent({
          ticketId,
          eventType: "tags_assigned",
          actorUserId: sessionUser.id,
          tenantKey: scope.tenantKey,
          workspaceKey: scope.workspaceKey,
          data: { tags: inferredTags }
        });
      }

      const queuedCall = await queueOutboundCall({
        tenantKey: scope.tenantKey,
        workspaceKey: scope.workspaceKey,
        ticketId,
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
        excerpt: previewText || data.subject,
        threadId: queuedCall.callSessionId
      });
      await enqueueAgentEvent({
        eventType: "ticket.created",
        payload: ticketEvent,
        tenantKey: scope.tenantKey,
        workspaceKey: scope.workspaceKey
      });
      void deliverPendingAgentEvents().catch(() => {});

      await recordModuleUsageEvent({
        tenantKey: scope.tenantKey,
        workspaceKey: scope.workspaceKey,
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
        tenantKey: scope.tenantKey,
        workspaceKey: scope.workspaceKey,
        inboundPhone: toPhone
      });
      const whatsappTicketMetadata = {
        source: "manual_outbound_whatsapp",
        createdByUserId: sessionUser.id,
        toPhone,
        ...(data.metadata ?? {})
      } as Record<string, unknown>;
      await syncVoiceConsentFromMetadata({
        tenantKey: scope.tenantKey,
        workspaceKey: scope.workspaceKey,
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
        tenantKey: scope.tenantKey,
        workspaceKey: scope.workspaceKey,
        mailboxId: mailbox.id,
        customerId: customerResolution?.customerId ?? null,
        requesterEmail: `whatsapp:${toPhone}`,
        subject: data.subject,
        category,
        metadata: whatsappTicketMetadata
      });

      await recordTicketEvent({
        ticketId,
        eventType: "ticket_created",
        actorUserId: sessionUser.id,
        tenantKey: scope.tenantKey,
        workspaceKey: scope.workspaceKey
      });

      if (inferredTags.length) {
        await addTagsToTicket(ticketId, inferredTags, scope);
        await recordTicketEvent({
          ticketId,
          eventType: "tags_assigned",
          actorUserId: sessionUser.id,
          tenantKey: scope.tenantKey,
          workspaceKey: scope.workspaceKey,
          data: { tags: inferredTags }
        });
      }

      const queuedMessage = await queueWhatsAppSend({
        tenantKey: scope.tenantKey,
        workspaceKey: scope.workspaceKey,
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
        excerpt: previewText || data.subject,
        threadId
      });
      await enqueueAgentEvent({
        eventType: "ticket.created",
        payload: ticketEvent,
        tenantKey: scope.tenantKey,
        workspaceKey: scope.workspaceKey
      });

      if (queuedMessage.messageId) {
        const messageEvent = buildAgentEvent({
          eventType: "ticket.message.created",
          ticketId,
          messageId: queuedMessage.messageId,
          mailboxId: mailbox.id,
          excerpt: previewText || data.subject,
          threadId
        });
        await enqueueAgentEvent({
          eventType: "ticket.message.created",
          payload: messageEvent,
          tenantKey: scope.tenantKey,
          workspaceKey: scope.workspaceKey
        });
      }

      void deliverPendingAgentEvents().catch(() => {});
      await recordModuleUsageEvent({
        tenantKey: scope.tenantKey,
        workspaceKey: scope.workspaceKey,
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
      tenantKey: scope.tenantKey,
      workspaceKey: scope.workspaceKey,
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
      tenantKey: scope.tenantKey,
      workspaceKey: scope.workspaceKey,
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
    metadata: (data.metadata as Record<string, unknown> | null) ?? null
  });
  const resolvedProfile = readExternalProfileFromMetadata(enrichedMetadata);
  const profileSource = readExternalProfileSource(enrichedMetadata);
  const profileMatchedBy = readExternalProfileMatchedBy(enrichedMetadata);
  const customerResolution = await resolveOrCreateCustomerForInbound({
    tenantKey: scope.tenantKey,
    workspaceKey: scope.workspaceKey,
    externalSystem: profileSource,
    profile: resolvedProfile,
    inboundEmail: fromEmail
  });
  if (customerResolution?.conflict) {
    enrichedMetadata = applyIdentityConflictMetadata(enrichedMetadata, customerResolution.conflict);
  }
  await syncVoiceConsentFromMetadata({
    tenantKey: scope.tenantKey,
    workspaceKey: scope.workspaceKey,
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
    tenantKey: scope.tenantKey,
    workspaceKey: scope.workspaceKey,
    mailboxId: mailbox.id,
    customerId: customerResolution?.customerId ?? null,
    requesterEmail: fromEmail,
    subject: data.subject,
    category,
    metadata: enrichedMetadata
  });

  await recordTicketEvent({
    ticketId,
    eventType: "ticket_created",
    tenantKey: scope.tenantKey,
    workspaceKey: scope.workspaceKey
  });

  if (inferredTags.length) {
    await addTagsToTicket(ticketId, inferredTags, scope);
    await recordTicketEvent({
      ticketId,
      eventType: "tags_assigned",
      tenantKey: scope.tenantKey,
      workspaceKey: scope.workspaceKey,
      data: { tags: inferredTags }
    });
  }

  if (resolvedProfile && !customerResolution?.conflict) {
    await upsertExternalUserLink({
      tenantKey: scope.tenantKey,
      workspaceKey: scope.workspaceKey,
      externalSystem: profileSource,
      profile: resolvedProfile,
      matchedBy: profileMatchedBy,
      inboundEmail: fromEmail,
      ticketId,
      channel: "email"
    });
    await recordTicketEvent({
      ticketId,
      eventType: "profile_enriched",
      tenantKey: scope.tenantKey,
      workspaceKey: scope.workspaceKey,
      data: {
        source: profileSource,
        matchedBy: profileMatchedBy,
        externalUserId: resolvedProfile.id
      }
    });
  } else if (resolvedProfile && customerResolution?.conflict) {
    await recordTicketEvent({
      ticketId,
      eventType: "customer_identity_conflict",
      tenantKey: scope.tenantKey,
      workspaceKey: scope.workspaceKey,
      data: {
        source: profileSource,
        matchedBy: profileMatchedBy,
        conflict: customerResolution.conflict
      }
    });
  }

  const messageId = randomUUID();
  const receivedAt = new Date();

  await db.query(
    `INSERT INTO messages (
      id, tenant_key, workspace_key, mailbox_id, ticket_id, direction, message_id, thread_id, from_email,
      to_emails, subject, preview_text, received_at, is_read
    ) VALUES (
      $1, $2, $3, $4, $5, 'inbound', $6, $7, $8,
      $9, $10, $11, $12, false
    )`,
    [
      messageId,
      scope.tenantKey,
      scope.workspaceKey,
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

  const keyPrefix = `tenants/${scope.tenantKey}/workspaces/${scope.workspaceKey}/messages/${messageId}`;
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
        `INSERT INTO attachments (
           id, tenant_key, workspace_key, message_id, filename, content_type, size_bytes, r2_key
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          attachmentId,
          scope.tenantKey,
          scope.workspaceKey,
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
     WHERE id = $4
       AND tenant_key = $5`,
    [textKey, htmlKey, sizeBytes || null, messageId, scope.tenantKey]
  );

  if (customerResolution?.customerId) {
    const identityEvent = buildAgentEvent({
      eventType: "customer.identity.resolved",
      ticketId,
      mailboxId: mailbox.id,
      excerpt: `Resolved customer ${customerResolution.customerId}`,
      threadId: messageId
    });
    await enqueueAgentEvent({
      eventType: "customer.identity.resolved",
      tenantKey: scope.tenantKey,
      workspaceKey: scope.workspaceKey,
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

  await recordTicketEvent({
    ticketId,
    eventType: "message_received",
    tenantKey: scope.tenantKey,
    workspaceKey: scope.workspaceKey
  });

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

  await enqueueAgentEvent({
    eventType: "ticket.message.created",
    payload: messageEvent,
    tenantKey: scope.tenantKey,
    workspaceKey: scope.workspaceKey
  });
  await enqueueAgentEvent({
    eventType: "ticket.created",
    payload: ticketEvent,
    tenantKey: scope.tenantKey,
    workspaceKey: scope.workspaceKey
  });
  void deliverPendingAgentEvents().catch(() => {});

  await recordModuleUsageEvent({
    tenantKey: scope.tenantKey,
    workspaceKey: scope.workspaceKey,
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
