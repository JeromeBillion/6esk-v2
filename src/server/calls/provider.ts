type OutboundCallPayload = {
  callSessionId?: unknown;
  ticketId?: unknown;
  messageId?: unknown;
  toPhone?: unknown;
  fromPhone?: unknown;
  reason?: unknown;
};

type HttpBridgeResponse = {
  providerCallId?: unknown;
  callId?: unknown;
};

function readString(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function getHttpBridgeTimeoutMs() {
  const parsed = Number(process.env.CALLS_PROVIDER_HTTP_TIMEOUT_MS ?? "8000");
  if (!Number.isFinite(parsed) || parsed < 500) {
    return 8000;
  }
  return Math.floor(parsed);
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

function buildCallbackUrl(appUrl: string, path: string) {
  return `${trimTrailingSlash(appUrl)}${path}`;
}

function buildWebhookAuthConfig() {
  return {
    sharedSecret: readString(process.env.INBOUND_SHARED_SECRET) ?? null,
    hmacSecret: readString(process.env.CALLS_WEBHOOK_SECRET) ?? null,
    maxSkewSeconds: Number(process.env.CALLS_WEBHOOK_MAX_SKEW_SECONDS ?? "300"),
    allowLegacyBodySignature:
      /^(1|true|yes|on)$/i.test((process.env.CALLS_WEBHOOK_ALLOW_LEGACY_BODY_SIGNATURE ?? "").trim())
  };
}

async function sendViaHttpBridge(
  eventId: string,
  payload: OutboundCallPayload
): Promise<{ providerCallId: string | null }> {
  const bridgeUrl = readString(process.env.CALLS_PROVIDER_HTTP_URL);
  if (!bridgeUrl) {
    throw new Error("CALLS_PROVIDER_HTTP_URL is not configured.");
  }

  const appUrl = readString(process.env.APP_URL);
  if (!appUrl) {
    throw new Error("APP_URL is required for outbound call callbacks.");
  }

  const callSessionId = readString(payload.callSessionId);
  const ticketId = readString(payload.ticketId);
  const messageId = readString(payload.messageId);
  const toPhone = readString(payload.toPhone);
  const fromPhone = readString(payload.fromPhone);
  const reason = readString(payload.reason);

  if (!callSessionId || !ticketId || !messageId || !toPhone) {
    throw new Error("Outbound call payload is incomplete.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), getHttpBridgeTimeoutMs());

  try {
    const response = await fetch(bridgeUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(readString(process.env.CALLS_PROVIDER_HTTP_SECRET)
          ? { "x-6esk-secret": readString(process.env.CALLS_PROVIDER_HTTP_SECRET)! }
          : {})
      },
      body: JSON.stringify({
        eventId,
        callSessionId,
        ticketId,
        messageId,
        toPhone,
        fromPhone,
        reason,
        callbacks: {
          statusUrl: buildCallbackUrl(appUrl, "/api/calls/status"),
          recordingUrl: buildCallbackUrl(appUrl, "/api/calls/recording"),
          transcriptUrl: buildCallbackUrl(appUrl, "/api/calls/transcript"),
          auth: buildWebhookAuthConfig()
        }
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(
        `Call bridge rejected outbound call (${response.status})${detail ? `: ${detail}` : "."}`
      );
    }

    const body = (await response.json().catch(() => null)) as HttpBridgeResponse | null;
    const providerCallId = readString(body?.providerCallId) ?? readString(body?.callId);
    if (!providerCallId) {
      throw new Error("Call bridge response missing providerCallId.");
    }

    return { providerCallId };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Call bridge timed out.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function sendOutboundCall(
  provider: string,
  eventId: string,
  payload: OutboundCallPayload
): Promise<{ providerCallId: string | null }> {
  if (provider === "mock") {
    return { providerCallId: `mock-${eventId}` };
  }

  if (provider === "http_bridge") {
    return sendViaHttpBridge(eventId, payload);
  }

  throw new Error(`Call provider '${provider}' is not configured.`);
}
