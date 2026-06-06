import { db } from "@/server/db";
import {
  storeInboundWhatsApp,
  type NormalizedWhatsAppAttachment,
  type NormalizedWhatsAppMessage
} from "@/server/whatsapp/inbound-store";
import { verifyWhatsAppSignature } from "@/server/whatsapp/signature";
import {
  resolveTenantScope,
  shouldRequireTenantIngressScope,
  type TenantScope,
  type TenantScopeInput
} from "@/server/tenant-context";
import {
  listActiveProviderWebhookSecrets,
  markProviderWebhookSecretUsed,
  ProviderWebhookSecretConfigurationError,
  shouldRequireTenantProviderWebhookSecrets,
  type ActiveProviderWebhookSecret
} from "@/server/provider-webhook-secrets";

type WhatsAppStatusUpdate = {
  messageId: string;
  status: string | null;
  timestamp: string | number | null;
  payload: Record<string, unknown>;
};

async function getVerifyToken(scopeInput?: TenantScopeInput) {
  const { tenantKey } = resolveTenantScope(scopeInput);
  const result = await db.query(
    `SELECT verify_token
     FROM whatsapp_accounts
     WHERE tenant_key = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [tenantKey]
  );
  const stored = result.rows[0]?.verify_token ?? "";
  return stored || process.env.WHATSAPP_VERIFY_TOKEN || "";
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizePhoneHint(value: unknown) {
  const text = readString(value);
  if (!text) return null;
  return text.replace(/\s+/g, "").trim();
}

function collectRoutingHints(payload: Record<string, unknown>) {
  const wabaIds = new Set<string>();
  const phoneNumbers = new Set<string>();

  const entries = Array.isArray(payload.entry) ? payload.entry : [];
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const entryRecord = entry as Record<string, unknown>;
    const entryId = readString(entryRecord.id);
    if (entryId) {
      wabaIds.add(entryId);
    }

    const changes = Array.isArray(entryRecord.changes) ? entryRecord.changes : [];
    for (const change of changes) {
      if (!change || typeof change !== "object") continue;
      const value = ((change as Record<string, unknown>).value ?? {}) as Record<string, unknown>;
      const metadata = (value.metadata ?? {}) as Record<string, unknown>;
      const displayPhoneNumber = normalizePhoneHint(metadata.display_phone_number);
      if (displayPhoneNumber) {
        phoneNumbers.add(displayPhoneNumber);
      }
    }
  }

  const normalizedMessages = Array.isArray(payload.messages) ? payload.messages : [];
  for (const message of normalizedMessages) {
    if (!message || typeof message !== "object") continue;
    const to = normalizePhoneHint((message as Record<string, unknown>).to);
    if (to) {
      phoneNumbers.add(to);
    }
  }

  return {
    wabaIds: [...wabaIds],
    phoneNumbers: [...phoneNumbers]
  };
}

function distinctScopes(rows: TenantScope[]) {
  const seen = new Set<string>();
  const scopes: TenantScope[] = [];
  for (const row of rows) {
    const scope = resolveTenantScope(row);
    const key = `${scope.tenantKey}:${scope.workspaceKey}`;
    if (seen.has(key)) continue;
    seen.add(key);
    scopes.push(scope);
  }
  return scopes;
}

async function resolveWhatsAppScopeForPayload(payload: Record<string, unknown>) {
  const { wabaIds, phoneNumbers } = collectRoutingHints(payload);
  if (!wabaIds.length && !phoneNumbers.length) {
    return null;
  }

  const result = await db.query<{ tenant_key: string; workspace_key: string }>(
    `SELECT tenant_key, workspace_key
     FROM whatsapp_accounts
     WHERE (cardinality($1::text[]) > 0 AND waba_id = ANY($1::text[]))
        OR (
          cardinality($2::text[]) > 0
          AND regexp_replace(phone_number, '\\s+', '', 'g') = ANY($2::text[])
        )
     ORDER BY status = 'active' DESC, created_at DESC`,
    [wabaIds, phoneNumbers]
  );
  const scopes = distinctScopes(
    result.rows.map((row) => ({
      tenantKey: row.tenant_key,
      workspaceKey: row.workspace_key
    }))
  );
  if (scopes.length > 1) {
    throw new Error("Ambiguous WhatsApp tenant route.");
  }
  return scopes[0] ?? null;
}

async function resolveWhatsAppScopeForVerifyToken(token: string) {
  const result = await db.query<{ tenant_key: string; workspace_key: string }>(
    `SELECT tenant_key, workspace_key
     FROM whatsapp_accounts
     WHERE verify_token = $1
     ORDER BY status = 'active' DESC, created_at DESC`,
    [token]
  );
  const scopes = distinctScopes(
    result.rows.map((row) => ({
      tenantKey: row.tenant_key,
      workspaceKey: row.workspace_key
    }))
  );
  if (scopes.length > 1) {
    throw new Error("Ambiguous WhatsApp verify token route.");
  }
  return scopes[0] ?? null;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  if (mode === "subscribe" && token) {
    let scope: TenantScope | null = null;
    try {
      scope = await resolveWhatsAppScopeForVerifyToken(token);
    } catch {
      return Response.json({ error: "Ambiguous verify token" }, { status: 409 });
    }
    const verifyToken = await getVerifyToken(scope ?? undefined);
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
      const metadata = (value.metadata ?? {}) as Record<string, unknown>;
      const displayPhoneNumber = normalizePhoneHint(metadata.display_phone_number);

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
          to: displayPhoneNumber,
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
  statuses: WhatsAppStatusUpdate[],
  scopeInput?: TenantScopeInput
) {
  const scope = resolveTenantScope(scopeInput);
  for (const status of statuses) {
    if (!status.messageId) continue;
    const timestamp = parseStatusTimestamp(status.timestamp ?? null);
    const messageResult = await db.query<{ id: string }>(
      `SELECT id
       FROM messages
       WHERE tenant_key = $1
         AND channel = 'whatsapp'
         AND external_message_id = $2
       LIMIT 1`,
      [scope.tenantKey, status.messageId]
    );
    const messageId = messageResult.rows[0]?.id ?? null;
    const eventPayload = {
      status: status.status ?? null,
      ...status.payload
    };
    await db.query(
      `INSERT INTO whatsapp_status_events (
         tenant_key, workspace_key, message_id, external_message_id, status, occurred_at, payload
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        scope.tenantKey,
        scope.workspaceKey,
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
       WHERE tenant_key = $3
         AND channel = 'whatsapp'
         AND external_message_id = $4`,
      [status.status ?? null, timestamp, scope.tenantKey, status.messageId]
    );
  }
}

export async function POST(request: Request) {
  let payload: unknown;
  const rawBody = await request.text();
  const providedSignature = request.headers.get("x-hub-signature-256");

  try {
    payload = rawBody ? JSON.parse(rawBody) : {};
  } catch (error) {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const normalizedPayload = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  let resolvedScope: TenantScope | null;
  try {
    resolvedScope = await resolveWhatsAppScopeForPayload(normalizedPayload);
  } catch {
    return Response.json({ error: "Ambiguous WhatsApp tenant route" }, { status: 409 });
  }
  if (!resolvedScope && shouldRequireTenantIngressScope()) {
    return Response.json(
      {
        error: "Unresolved WhatsApp tenant route",
        code: "unresolved_whatsapp_tenant_route"
      },
      { status: 404 }
    );
  }
  if (!resolvedScope && shouldRequireTenantProviderWebhookSecrets()) {
    return Response.json(
      {
        error: "Unresolved WhatsApp tenant route",
        code: "unresolved_whatsapp_tenant_route"
      },
      { status: 404 }
    );
  }
  const scope = resolvedScope ?? resolveTenantScope();

  let providerSecrets: ActiveProviderWebhookSecret[] = [];
  try {
    providerSecrets = resolvedScope
      ? await listActiveProviderWebhookSecrets({
          scope,
          provider: "whatsapp",
          secretType: "app_secret"
        })
      : [];
  } catch (error) {
    if (error instanceof ProviderWebhookSecretConfigurationError) {
      return Response.json(
        {
          error: error.message,
          code: "provider_webhook_secret_configuration_missing"
        },
        { status: 503 }
      );
    }
    throw error;
  }

  const globalAppSecret = process.env.WHATSAPP_APP_SECRET?.trim();
  if (globalAppSecret && !shouldRequireTenantProviderWebhookSecrets()) {
    providerSecrets.push({
      id: "env:WHATSAPP_APP_SECRET",
      secret: globalAppSecret,
      source: "env"
    });
  }

  let matchedSecret: ActiveProviderWebhookSecret | null = null;
  if (providerSecrets.length) {
    matchedSecret =
      providerSecrets.find((secret) =>
        verifyWhatsAppSignature({
          body: rawBody,
          providedSignature,
          appSecret: secret.secret
        })
      ) ?? null;
    if (!matchedSecret) {
      return Response.json({ error: "Invalid signature" }, { status: 401 });
    }
    await markProviderWebhookSecretUsed(matchedSecret.id, scope).catch(() => {});
  } else if (shouldRequireTenantProviderWebhookSecrets()) {
    return Response.json(
      {
        error: "Provider webhook secret is not configured for this tenant.",
        code: "provider_webhook_secret_missing"
      },
      { status: 503 }
    );
  } else if (
    !verifyWhatsAppSignature({
      body: rawBody,
      providedSignature,
      appSecret: ""
    })
  ) {
    return Response.json({ error: "Invalid signature" }, { status: 401 });
  }

  await db.query(
    `INSERT INTO whatsapp_events (tenant_key, workspace_key, direction, payload, status)
     VALUES ($1, $2, $3, $4, $5)`,
    [scope.tenantKey, scope.workspaceKey, "inbound", payload, "received"]
  );
  const { messages: normalizedMessages, statuses: normalizedStatuses } =
    extractNormalizedMessages(normalizedPayload);
  const { messages: metaMessages, statuses: metaStatuses } = extractMetaMessages(normalizedPayload);

  const messages = normalizedMessages.length ? normalizedMessages : metaMessages;
  const statuses = normalizedStatuses.length ? normalizedStatuses : metaStatuses;

  let processed = 0;
  for (const message of messages) {
    try {
      await storeInboundWhatsApp(message, scope);
      processed += 1;
    } catch (error) {
      continue;
    }
  }

  if (statuses.length) {
    await applyStatusUpdates(statuses, scope);
  }

  return Response.json({ status: "received", processed, statusUpdates: statuses.length });
}
