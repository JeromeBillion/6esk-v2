import twilio from "twilio";
import {
  buildTwilioDialTwiML,
  buildTwilioPublicUrl,
  getTwilioCredentials,
  normalizeTwilioPhoneOrNull,
  resolveTwilioCallerId
} from "@/server/calls/twilio";
import { resolveVoiceDeskTargetsForOutbound } from "@/server/calls/operators";

type OutboundCallPayload = {
  callSessionId?: unknown;
  ticketId?: unknown;
  messageId?: unknown;
  toPhone?: unknown;
  fromPhone?: unknown;
  reason?: unknown;
  actorUserId?: unknown;
  actorIntegrationId?: unknown;
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
          statusUrl: buildTwilioPublicUrl("/api/calls/status"),
          recordingUrl: buildTwilioPublicUrl("/api/calls/recording"),
          transcriptUrl: buildTwilioPublicUrl("/api/calls/transcript"),
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

async function sendViaTwilio(
  eventId: string,
  payload: OutboundCallPayload
): Promise<{ providerCallId: string | null }> {
  const callSessionId = readString(payload.callSessionId);
  const ticketId = readString(payload.ticketId);
  const messageId = readString(payload.messageId);
  const toPhone = normalizeTwilioPhoneOrNull(readString(payload.toPhone));
  const fromPhone = resolveTwilioCallerId(readString(payload.fromPhone));
  const reason = readString(payload.reason);
  const actorUserId = readString(payload.actorUserId);

  if (!callSessionId || !ticketId || !messageId || !toPhone) {
    throw new Error("Outbound call payload is incomplete.");
  }

  const { accountSid, authToken } = getTwilioCredentials();
  const client = twilio(accountSid, authToken);
  const statusCallback = buildTwilioPublicUrl("/api/calls/webhooks/twilio/status");
  const recordingCallback = buildTwilioPublicUrl("/api/calls/webhooks/twilio/recording");
  const deskTargets = await resolveVoiceDeskTargetsForOutbound(actorUserId);
  if (!deskTargets.length) {
    throw new Error("No online desk operator is available to accept the call.");
  }
  const twiml = buildTwilioDialTwiML({
    targets: deskTargets.map((target) => ({
      type: "client" as const,
      identity: target.identity,
      parameters: {
        callSessionId,
        ticketId,
        messageId,
        fromPhone: toPhone,
        toPhone: fromPhone,
        direction: "outbound",
        operatorUserId: target.userId,
        operatorName: target.displayName
      }
    })),
    callerId: fromPhone,
    recordingCallbackUrl: recordingCallback,
    timeoutSeconds: Number(process.env.CALLS_TWILIO_OPERATOR_RING_TIMEOUT_SECONDS ?? "25")
  });

  const call = await client.calls.create({
    to: toPhone,
    from: fromPhone,
    twiml,
    statusCallback,
    statusCallbackMethod: "GET",
    statusCallbackEvent: ["initiated", "ringing", "answered", "completed"]
  });

  if (!call.sid) {
    throw new Error(`Twilio call response missing SID for event ${eventId}.`);
  }

  return { providerCallId: call.sid };
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

  if (provider === "twilio") {
    return sendViaTwilio(eventId, payload);
  }

  throw new Error(`Call provider '${provider}' is not configured.`);
}
