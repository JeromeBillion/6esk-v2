import { z } from "zod";
import { randomUUID } from "crypto";
import { db } from "@/server/db";
import { getOrCreateMailbox } from "@/server/email/mailbox";
import { normalizeAddressList } from "@/server/email/normalize";
import { putObject } from "@/server/storage/r2";
import {
  addTagsToTicket,
  createTicket,
  inferTagsFromText,
  recordTicketEvent
} from "@/server/tickets";
import { buildAgentEvent } from "@/server/agents/events";
import { deliverPendingAgentEvents, enqueueAgentEvent } from "@/server/agents/outbox";
import { resolveOrCreateCustomerForInbound } from "@/server/customers";
import {
  integrationError,
  integrationSuccess,
  validateIntegrationApiVersion
} from "@/server/api-contract";
import { runInBackground } from "@/server/async";
import {
  isTenantPublicIngressError,
  tenantScopeFromPublicIngressRequest
} from "@/server/tenant-public-ingress";

const portalSchema = z.object({
  from: z.string().email(),
  subject: z.string().min(1),
  description: z.string().min(1),
  category: z.string().optional().nullable(),
  metadata: z.record(z.unknown()).optional().nullable()
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
  const versionError = validateIntegrationApiVersion(request);
  if (versionError) {
    return versionError;
  }

  // Portal callers must provide a shared secret. Without this the endpoint
  // is completely unauthenticated and attackable.
  const portalSecret = process.env.PORTAL_SHARED_SECRET ?? process.env.INBOUND_SHARED_SECRET ?? "";
  const provided = request.headers.get("x-portal-secret") ?? request.headers.get("x-6esk-secret");
  if (!portalSecret || provided !== portalSecret) {
    return integrationError(request, {
      status: 401,
      code: "unauthorized",
      message: "Unauthorized"
    });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch (error) {
    return integrationError(request, {
      status: 400,
      code: "invalid_json",
      message: "Invalid JSON body"
    });
  }

  const parsed = portalSchema.safeParse(payload);
  if (!parsed.success) {
    return integrationError(request, {
      status: 400,
      code: "invalid_payload",
      message: "Invalid payload",
      details: parsed.error.flatten()
    });
  }

  const data = parsed.data;
  let tenantId: string;
  try {
    tenantId = (await tenantScopeFromPublicIngressRequest(request)).tenantId;
  } catch (error) {
    if (isTenantPublicIngressError(error)) {
      return integrationError(request, {
        status: error.status,
        code: error.code,
        message: error.message
      });
    }
    throw error;
  }
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
  const fromEmail = normalizeAddressList(data.from)[0];
  if (!fromEmail) {
    return integrationError(request, {
      status: 400,
      code: "invalid_sender_address",
      message: "Invalid sender address"
    });
  }

  const inferredTags = inferTagsFromText({ subject: data.subject, text: data.description });
  const category =
    data.category?.toLowerCase().trim() ?? inferredTags[0]?.toLowerCase() ?? null;
  const metadata = {
    source: "portal",
    ...(data.metadata ?? {})
  };
  const customerResolution = await resolveOrCreateCustomerForInbound({
    tenantId,
    inboundEmail: fromEmail
  });

  const ticketId = await createTicket({
    tenantId,
    mailboxId: mailbox.id,
    customerId: customerResolution?.customerId ?? null,
    requesterEmail: fromEmail,
    subject: data.subject,
    category,
    metadata
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

  const messageId = randomUUID();
  const receivedAt = new Date();
  const previewText = data.description.replace(/\s+/g, " ").trim().slice(0, 200);

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
  const textKey = await putObject({
    key: `${keyPrefix}/body.txt`,
    body: data.description,
    contentType: "text/plain; charset=utf-8"
  });

  await db.query(
    `UPDATE messages
     SET r2_key_text = $1, size_bytes = $2
     WHERE id = $3`,
    [textKey, Buffer.byteLength(data.description), messageId]
  );

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
    route: "/api/portal/tickets",
    tenantId,
    ticketId
  });

  return integrationSuccess(request, { status: "created", ticketId, messageId });
}
