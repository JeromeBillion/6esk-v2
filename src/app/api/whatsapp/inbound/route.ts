import { db } from "@/server/db";
import {
  storeInboundWhatsApp,
  type NormalizedWhatsAppAttachment,
  type NormalizedWhatsAppMessage
} from "@/server/whatsapp/inbound-store";
import { verifyWhatsAppSignature } from "@/server/whatsapp/signature";
import { canAcceptUnsignedWebhookTraffic } from "@/server/security/webhooks";

type WhatsAppStatusUpdate = {
  messageId: string;
  status: string | null;
  timestamp: string | number | null;
  payload: Record<string, unknown>;
};

async function getVerifyToken() {
  const result = await db.query(
    `SELECT verify_token FROM whatsapp_accounts ORDER BY created_at DESC LIMIT 1`
  );
  const stored = result.rows[0]?.verify_token ?? "";
  return stored || process.env.WHATSAPP_VERIFY_TOKEN || "";
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  if (mode === "subscribe" && token) {
    const verifyToken = await getVerifyToken();
    if (verifyToken && token === verifyToken) {
      return new Response(challenge ?? "", { status: 200 });
    }
  }

  return Response.json({ error: "Forbidden" }, { status: 403 });
}

function extractNormalizedMessages(payload: Record<string, unknown>) {
  const provider = typeof payload.provider === "string" ? payload.provider : "meta";
  const rawMessages = Array.isArray(payload.messages) ? payload.messages : [];
  const messages = rawMessages
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const text =
        typeof record.text === "string"
          ? record.text
          : typeof record.body === "string"
            ? record.body
            : null;
      const from = typeof record.from === "string" ? record.from : "";
      const messageId = typeof record.id === "string" ? record.id : null;
      const timestamp = (record.timestamp as string | number | null | undefined) ?? null;
      const conversationId =
        typeof record.conversationId === "string" ? record.conversationId : null;
      const rawAttachments = Array.isArray(record.attachments) ? record.attachments : [];
      const attachments = rawAttachments
        .map((attachment) => {
          if (!attachment || typeof attachment !== "object") return null;
          const data = attachment as Record<string, unknown>;
          return {
            mediaId: typeof data.id === "string" ? data.id : null,
            mimeType:
              typeof data.mimeType === "string"
                ? data.mimeType
                : typeof data.mime_type === "string"
                  ? data.mime_type
                  : null,
            filename: typeof data.filename === "string" ? data.filename : null,
            caption: typeof data.caption === "string" ? data.caption : null,
            type: typeof data.type === "string" ? data.type : null,
            contentBase64:
              typeof data.contentBase64 === "string"
                ? data.contentBase64
                : typeof data.content_base64 === "string"
                  ? data.content_base64
                  : null
          } satisfies NormalizedWhatsAppAttachment;
        })
        .filter(Boolean) as NormalizedWhatsAppAttachment[];

      if (!from) return null;
      return {
        provider,
        messageId,
        conversationId,
        from,
        to: typeof record.to === "string" ? record.to : null,
        text,
        timestamp,
        contactName: typeof record.contactName === "string" ? record.contactName : null,
        attachments: attachments.length ? attachments : null
      };
    })
    .filter(Boolean) as NormalizedWhatsAppMessage[];

  const rawStatuses = Array.isArray(payload.statuses) ? payload.statuses : [];
  const statuses: WhatsAppStatusUpdate[] = [];
  for (const item of rawStatuses) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const messageId = typeof record.id === "string" ? record.id : null;
    if (!messageId) continue;
    const timestamp = record.timestamp as string | number | null | undefined;
    const payload =
      record.payload && typeof record.payload === "object"
        ? (record.payload as Record<string, unknown>)
        : null;
    statuses.push({
      messageId,
      status: typeof record.status === "string" ? record.status : null,
      timestamp: timestamp ?? null,
      payload: payload
        ? {
            source: "webhook",
            ...payload
          }
        : { source: "webhook" }
    });
  }

  return { messages, statuses };
}

function extractMetaMessages(payload: Record<string, unknown>) {
  if (payload.object !== "whatsapp_business_account") {
    return { messages: [], statuses: [] };
  }

  const entries = Array.isArray(payload.entry) ? payload.entry : [];
  const messages: NormalizedWhatsAppMessage[] = [];
  const statuses: WhatsAppStatusUpdate[] = [];

  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const entryRecord = entry as Record<string, unknown>;
    const changes = Array.isArray(entryRecord.changes) ? entryRecord.changes : [];

    for (const change of changes) {
      if (!change || typeof change !== "object") continue;
      const changeRecord = change as Record<string, unknown>;
      const value = (changeRecord.value ?? {}) as Record<string, unknown>;

      const contacts = Array.isArray(value.contacts) ? value.contacts : [];
      const messagesList = Array.isArray(value.messages) ? value.messages : [];
      const statusList = Array.isArray(value.statuses) ? value.statuses : [];

      for (const message of messagesList) {
        if (!message || typeof message !== "object") continue;
        const msg = message as Record<string, unknown>;
        const from = typeof msg.from === "string" ? msg.from : "";
        const messageId = typeof msg.id === "string" ? msg.id : null;
        const timestamp = (msg.timestamp as string | number | null | undefined) ?? null;
        const messageType = typeof msg.type === "string" ? msg.type : "text";
        const text =
          typeof (msg.text as Record<string, unknown> | undefined)?.body === "string"
            ? ((msg.text as Record<string, unknown>).body as string)
            : typeof msg.body === "string"
              ? msg.body
              : null;
        const attachments: NormalizedWhatsAppAttachment[] = [];
        if (messageType !== "text") {
          const media = msg[messageType] as Record<string, unknown> | undefined;
          const mediaId = typeof media?.id === "string" ? media.id : null;
          if (mediaId) {
            attachments.push({
              mediaId,
              mimeType: typeof media?.mime_type === "string" ? media.mime_type : null,
              filename: typeof media?.filename === "string" ? media.filename : null,
              caption: typeof media?.caption === "string" ? media.caption : null,
              type: messageType
            });
          }
        }
        const contact =
          contacts.find((contact) => {
            if (!contact || typeof contact !== "object") return false;
            const record = contact as Record<string, unknown>;
            return record.wa_id === from;
          }) ?? null;
        const contactName =
          contact && typeof (contact as Record<string, unknown>).profile === "object"
            ? (((contact as Record<string, unknown>).profile as Record<string, unknown>).name as string | null) ??
              null
            : null;

        if (!from) continue;
        messages.push({
          provider: "meta",
          messageId,
          conversationId: from,
          from,
          text: text ?? attachments[0]?.caption ?? null,
          timestamp,
          contactName,
          attachments: attachments.length ? attachments : null
        });
      }

      for (const status of statusList) {
        if (!status || typeof status !== "object") continue;
        const record = status as Record<string, unknown>;
        const messageId = typeof record.id === "string" ? record.id : null;
        if (!messageId) continue;
        const timestamp = record.timestamp as string | number | null | undefined;
        const eventPayload: Record<string, unknown> = {
          source: "webhook",
          provider: "meta"
        };
        if (typeof record.recipient_id === "string") {
          eventPayload.recipientId = record.recipient_id;
        }
        if (typeof record.biz_opaque_callback_data === "string") {
          eventPayload.callbackData = record.biz_opaque_callback_data;
        }
        if (record.conversation && typeof record.conversation === "object") {
          eventPayload.conversation = record.conversation;
        }
        if (record.pricing && typeof record.pricing === "object") {
          eventPayload.pricing = record.pricing;
        }
        if (Array.isArray(record.errors) && record.errors.length > 0) {
          eventPayload.errors = record.errors;
        }
        statuses.push({
          messageId,
          status: typeof record.status === "string" ? record.status : null,
          timestamp: timestamp ?? null,
          payload: eventPayload
        });
      }
    }
  }

  return { messages, statuses };
}

function parseStatusTimestamp(value: string | number | null | undefined) {
  if (!value) return null;
  if (typeof value === "number") {
    return new Date(value < 1e12 ? value * 1000 : value);
  }
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) {
    const numeric = Number(trimmed);
    return new Date(numeric < 1e12 ? numeric * 1000 : numeric);
  }
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

async function applyStatusUpdates(
  statuses: WhatsAppStatusUpdate[]
) {
  for (const status of statuses) {
    if (!status.messageId) continue;
    const timestamp = parseStatusTimestamp(status.timestamp ?? null);
    const messageResult = await db.query<{ id: string }>(
      `SELECT id
       FROM messages
       WHERE channel = 'whatsapp' AND external_message_id = $1
       LIMIT 1`,
      [status.messageId]
    );
    const messageId = messageResult.rows[0]?.id ?? null;
    const eventPayload = {
      status: status.status ?? null,
      ...status.payload
    };
    await db.query(
      `INSERT INTO whatsapp_status_events (message_id, external_message_id, status, occurred_at, payload)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        messageId,
        status.messageId,
        status.status ?? "unknown",
        timestamp ?? new Date(),
        eventPayload
      ]
    );
    await db.query(
      `UPDATE messages
       SET wa_status = $1,
           wa_timestamp = COALESCE($2, wa_timestamp)
       WHERE channel = 'whatsapp' AND external_message_id = $3`,
      [status.status ?? null, timestamp, status.messageId]
    );
  }
}

export async function POST(request: Request) {
  let payload: unknown;
  const rawBody = await request.text();
  const appSecret = process.env.WHATSAPP_APP_SECRET ?? "";
  const providedSignature = request.headers.get("x-hub-signature-256");

  const signatureValid = verifyWhatsAppSignature({
    body: rawBody,
    providedSignature,
    appSecret,
    requireSignature: !canAcceptUnsignedWebhookTraffic(process.env.WHATSAPP_ALLOW_UNSIGNED_WEBHOOKS)
  });

  if (!signatureValid) {
    return Response.json({ error: "Invalid signature" }, { status: 401 });
  }

  try {
    payload = rawBody ? JSON.parse(rawBody) : {};
  } catch (error) {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  await db.query(
    `INSERT INTO whatsapp_events (direction, payload, status)
     VALUES ($1, $2, $3)`,
    ["inbound", payload, "received"]
  );

  const normalizedPayload = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const { messages: normalizedMessages, statuses: normalizedStatuses } =
    extractNormalizedMessages(normalizedPayload);
  const { messages: metaMessages, statuses: metaStatuses } = extractMetaMessages(normalizedPayload);

  const messages = normalizedMessages.length ? normalizedMessages : metaMessages;
  const statuses = normalizedStatuses.length ? normalizedStatuses : metaStatuses;

  let processed = 0;
  for (const message of messages) {
    try {
      await storeInboundWhatsApp(message);
      processed += 1;
    } catch (error) {
      continue;
    }
  }

  if (statuses.length) {
    await applyStatusUpdates(statuses);
  }

  return Response.json({ status: "received", processed, statusUpdates: statuses.length });
}
