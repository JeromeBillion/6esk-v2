import { Resend, type EmailReceivedEvent, type WebhookEventPayload } from "resend";

function readHeaderCaseInsensitive(headers: Record<string, string> | null | undefined, key: string) {
  if (!headers) {
    return null;
  }
  const expected = key.toLowerCase();
  for (const [headerKey, value] of Object.entries(headers)) {
    if (headerKey.toLowerCase() === expected) {
      return value;
    }
  }
  return null;
}

export function getResendClient() {
  return new Resend(process.env.RESEND_API_KEY ?? "");
}

export function verifyResendWebhookPayload({
  payload,
  headers
}: {
  payload: string;
  headers: globalThis.Headers;
}): WebhookEventPayload {
  const webhookSecret = process.env.RESEND_WEBHOOK_SECRET ?? "";
  if (!webhookSecret) {
    throw new Error("RESEND_WEBHOOK_SECRET is not configured.");
  }

  const signatureHeaders = {
    id: headers.get("svix-id") ?? "",
    timestamp: headers.get("svix-timestamp") ?? "",
    signature: headers.get("svix-signature") ?? ""
  };
  if (!signatureHeaders.id || !signatureHeaders.timestamp || !signatureHeaders.signature) {
    throw new Error("Missing Resend webhook signature headers.");
  }

  return getResendClient().webhooks.verify({
    payload,
    headers: signatureHeaders,
    webhookSecret
  });
}

export async function mapReceivedEmailToInboundPayload(event: EmailReceivedEvent) {
  const resend = getResendClient();
  const received = await resend.emails.receiving.get(event.data.email_id);
  if (received.error || !received.data) {
    throw new Error(received.error?.message ?? "Failed to load received email from Resend.");
  }

  const inReplyTo = readHeaderCaseInsensitive(received.data.headers, "in-reply-to");
  const referencesHeader = readHeaderCaseInsensitive(received.data.headers, "references");
  const references = referencesHeader
    ? referencesHeader
        .split(/\s+/)
        .map((value) => value.trim())
        .filter(Boolean)
    : [];

  const rawUrl = received.data.raw?.download_url ?? null;
  let raw: string | null = null;
  if (rawUrl) {
    const rawResponse = await fetch(rawUrl);
    if (rawResponse.ok) {
      raw = await rawResponse.text();
    }
  }

  return {
    from: received.data.from,
    to: received.data.to,
    cc: received.data.cc,
    bcc: received.data.bcc,
    subject: received.data.subject,
    text: received.data.text,
    html: received.data.html,
    raw,
    messageId: received.data.message_id,
    inReplyTo,
    references,
    date: received.data.created_at,
    attachments: received.data.attachments.map((attachment) => ({
      filename: attachment.filename ?? attachment.id,
      contentType: attachment.content_type ?? null,
      size: attachment.size ?? null,
      contentBase64: null
    })),
    metadata: {
      source: "resend",
      resendEmailId: event.data.email_id
    }
  };
}
