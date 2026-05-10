import { randomUUID } from "crypto";
import { db } from "@/server/db";
import { putObject } from "@/server/storage/r2";
import { getTicketById, recordTicketEvent } from "@/server/tickets";
import { getCustomerById } from "@/server/customers";
import { queueWhatsAppSend } from "@/server/whatsapp/send";
import { getWhatsAppWindowStatus } from "@/server/whatsapp/window";
import { DEFAULT_TENANT_ID } from "@/server/tenant/types";

type SendReplyArgs = {
  tenantId?: string | null;
  ticketId: string;
  text?: string | null;
  html?: string | null;
  subject?: string | null;
  attachments?: Array<{
    filename: string;
    contentType?: string | null;
    size?: number | null;
    contentBase64: string;
  }> | null;
  template?: Record<string, unknown> | null;
  actorUserId?: string | null;
  origin?: "human" | "ai";
  aiMeta?: Record<string, unknown> | null;
  recipient?: string | null;
};

function getSupportAddress() {
  const explicit = process.env.SUPPORT_ADDRESS;
  if (explicit) {
    return explicit.toLowerCase();
  }
  const domain = process.env.RESEND_FROM_DOMAIN ?? "";
  return domain ? `support@${domain}`.toLowerCase() : "";
}

function normalizeEmailRecipient(value: string | null | undefined) {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  return normalized || null;
}

function normalizePhoneRecipient(value: string | null | undefined) {
  if (!value) return null;
  const normalized = value.replace(/[^\d+]/g, "").trim();
  return normalized || null;
}

type ResendResponse = {
  id?: string;
  messageId?: string;
};

export async function sendTicketReply({
  tenantId,
  ticketId,
  text,
  html,
  subject,
  attachments,
  template,
  actorUserId,
  origin = "human",
  aiMeta,
  recipient
}: SendReplyArgs) {
  const lookupTenantId = tenantId ?? DEFAULT_TENANT_ID;
  const ticket = await getTicketById(ticketId, lookupTenantId);
  if (!ticket) {
    throw new Error("Ticket not found");
  }
  const effectiveTenantId = ticket.tenant_id;

  const customer = ticket.customer_id ? await getCustomerById(ticket.customer_id, effectiveTenantId) : null;
  const requestedEmailRecipient = normalizeEmailRecipient(recipient);
  const requestedPhoneRecipient = normalizePhoneRecipient(recipient);

  const isWhatsAppTicket =
    ticket.requester_email?.startsWith("whatsapp:") ||
    (ticket.metadata && (ticket.metadata as Record<string, unknown>).channel === "whatsapp");

  if (isWhatsAppTicket) {
    const fallbackTicketPhone = normalizePhoneRecipient(
      ticket.requester_email?.replace(/^whatsapp:/, "") ?? null
    );
    const defaultPhone =
      customer?.kind === "registered"
        ? normalizePhoneRecipient(customer.primary_phone) ?? fallbackTicketPhone
        : fallbackTicketPhone ?? normalizePhoneRecipient(customer?.primary_phone);
    const resolvedPhone = requestedPhoneRecipient ?? defaultPhone;
    if (!resolvedPhone) {
      throw new Error("No WhatsApp recipient is available. Select a recipient.");
    }

    const body =
      text ??
      (html
        ? html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
        : "");
    const cleanBody = body.trim() ? body : null;
    const attachmentList = attachments ?? [];
    if (attachmentList.length > 1) {
      throw new Error("WhatsApp supports one attachment per message.");
    }
    if (attachmentList.length && template) {
      throw new Error("Templates cannot be combined with attachments.");
    }
    if (!cleanBody && !template && attachmentList.length === 0) {
      throw new Error("Reply body required");
    }
    const windowStatus = await getWhatsAppWindowStatus(ticketId, effectiveTenantId);
    if (!windowStatus.isOpen && !template) {
      throw new Error("WhatsApp 24h window closed. Template required.");
    }

    const messageMetadata = {
      recipient: {
        channel: "whatsapp",
        value: resolvedPhone,
        selectedValue: requestedPhoneRecipient ?? null,
        source: requestedPhoneRecipient
          ? "agent_selected"
          : customer?.kind === "registered" && normalizePhoneRecipient(customer.primary_phone)
            ? "customer_primary"
            : "ticket_requester",
        customerId: ticket.customer_id ?? null,
        customerKind: customer?.kind ?? null
      }
    };

    const result = await queueWhatsAppSend({
      tenantId: effectiveTenantId,
      ticketId,
      to: resolvedPhone,
      text: cleanBody,
      attachments: attachmentList,
      template: template ?? null,
      actorUserId: actorUserId ?? null,
      origin,
      aiMeta: aiMeta ?? null,
      messageMetadata
    });
    return { messageId: result.messageId ?? null };
  }

  if (!text && !html) {
    throw new Error("Reply body required");
  }

  const from = getSupportAddress();
  if (!from) {
    throw new Error("Support address not configured");
  }

  const fallbackTicketEmail = ticket.requester_email?.startsWith("whatsapp:")
    ? null
    : normalizeEmailRecipient(ticket.requester_email);
  const defaultEmail =
    customer?.kind === "registered"
      ? normalizeEmailRecipient(customer.primary_email) ?? fallbackTicketEmail
      : fallbackTicketEmail ?? normalizeEmailRecipient(customer?.primary_email);
  const resolvedEmail = requestedEmailRecipient ?? defaultEmail;
  if (!resolvedEmail) {
    throw new Error("No email recipient is available. Select a recipient.");
  }

  const messageMetadata = {
    recipient: {
      channel: "email",
      value: resolvedEmail,
      selectedValue: requestedEmailRecipient ?? null,
      source: requestedEmailRecipient
        ? "agent_selected"
        : customer?.kind === "registered" && normalizeEmailRecipient(customer.primary_email)
          ? "customer_primary"
          : "ticket_requester",
      customerId: ticket.customer_id ?? null,
      customerKind: customer?.kind ?? null
    }
  };

  const finalSubject = subject ?? (ticket.subject ? `Re: ${ticket.subject}` : "Re: Support request");

  const connection = await import("@/server/oauth/connections").then(m => m.getActiveConnectionForMailbox(from));

  let providerMessageId: string | null = null;

  if (connection?.provider === "google" || connection?.provider === "microsoft" || connection?.provider === "zoho") {
    const { getConnectionTokens } = await import("@/server/oauth/connections");
    const { decryptToken } = await import("@/server/oauth/crypto");

    const tokens = await getConnectionTokens(connection.id);
    if (!tokens) throw new Error("Connection tokens missing");

    const combinedStr = decryptToken(tokens.accessTokenEnc, tokens.tokenIv);
    const { accessToken } = JSON.parse(combinedStr);

    const emailPayload = {
      to: [resolvedEmail],
      subject: finalSubject,
      html: html ?? undefined,
      text: text ?? undefined
    };

    if (connection.provider === "google") {
      const { sendGmailMessage } = await import("@/server/oauth/providers/google");
      const result = await sendGmailMessage(accessToken, emailPayload);
      providerMessageId = result.messageId;
    } else if (connection.provider === "microsoft") {
      const { sendOutlookMessage } = await import("@/server/oauth/providers/microsoft");
      const result = await sendOutlookMessage(accessToken, emailPayload);
      providerMessageId = result.messageId;
    } else if (connection.provider === "zoho") {
      const { sendZohoMessage } = await import("@/server/oauth/providers/zoho");
      const result = await sendZohoMessage(accessToken, connection.provider_account_id!, emailPayload);
      providerMessageId = result.messageId;
    }
  } else {
    // Fallback to Resend
    const resendPayload = {
      from,
      to: [resolvedEmail],
      subject: finalSubject,
      html: html ?? undefined,
      text: text ?? undefined
    };

    const resendResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY ?? ""}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(resendPayload)
    });

    if (!resendResponse.ok) {
      const errorBody = await resendResponse.text();
      throw new Error(errorBody || "Resend request failed");
    }

    const resendData = (await resendResponse.json()) as ResendResponse;
    providerMessageId = resendData.messageId ?? resendData.id ?? null;
  }

  const messageId = randomUUID();
  const sentAt = new Date();

  await db.query(
    `INSERT INTO messages (
      tenant_id, id, mailbox_id, ticket_id, direction, message_id, thread_id, from_email,
      to_emails, subject, preview_text, sent_at, is_read, origin, ai_meta, metadata
    ) VALUES (
      $1, $2, $3, $4, 'outbound', $5, $6, $7,
      $8, $9, $10, $11, true, $12, $13, $14
    )`,
    [
      effectiveTenantId,
      messageId,
      ticket.mailbox_id,
      ticketId,
      providerMessageId,
      providerMessageId ?? messageId,
      from,
      [resolvedEmail],
      finalSubject,
      (text ?? "").replace(/\s+/g, " ").trim().slice(0, 200) || null,
      sentAt,
      origin,
      aiMeta ?? null,
      messageMetadata
    ]
  );

  const keyPrefix = `messages/${messageId}`;
  let textKey: string | null = null;
  let htmlKey: string | null = null;
  let sizeBytes = 0;

  if (text) {
    textKey = await putObject({
      key: `${keyPrefix}/body.txt`,
      body: text,
      contentType: "text/plain; charset=utf-8"
    });
    sizeBytes += Buffer.byteLength(text);
  }

  if (html) {
    htmlKey = await putObject({
      key: `${keyPrefix}/body.html`,
      body: html,
      contentType: "text/html; charset=utf-8"
    });
    sizeBytes += Buffer.byteLength(html);
  }

  await db.query(
    `UPDATE messages
     SET r2_key_text = $1, r2_key_html = $2, size_bytes = $3
     WHERE id = $4`,
    [textKey, htmlKey, sizeBytes || null, messageId]
  );

  await recordTicketEvent({
    tenantId: effectiveTenantId,
    ticketId,
    eventType: origin === "ai" ? "ai_reply_sent" : "reply_sent",
    actorUserId: actorUserId ?? null,
    data: origin === "ai" ? { ai: true } : null
  });

  if (ticket.status === "new" || ticket.status === "pending") {
    await db.query(
      "UPDATE tickets SET status = 'open', updated_at = now() WHERE id = $1 AND tenant_id = $2",
      [ticketId, effectiveTenantId]
    );
    await recordTicketEvent({
      tenantId: effectiveTenantId,
      ticketId,
      eventType: "status_updated",
      actorUserId: actorUserId ?? null,
      data: { from: ticket.status, to: "open" }
    });
  }

  return { messageId };
}
