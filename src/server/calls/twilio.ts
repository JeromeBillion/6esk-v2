import twilio from "twilio";
import { normalizeLinkPhone } from "@/server/integrations/external-user-links";
import type { CallStatus } from "@/server/calls/service";

function readString(value: string | null | undefined) {
  const trimmed = (value ?? "").trim();
  return trimmed || null;
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

export function buildTwilioPublicUrl(path: string, requestUrl?: string) {
  const configured = readString(process.env.APP_URL);
  if (configured) {
    return `${trimTrailingSlash(configured)}${path}`;
  }
  if (requestUrl) {
    const url = new URL(requestUrl);
    return `${trimTrailingSlash(url.origin)}${path}`;
  }
  throw new Error("APP_URL is required for Twilio callbacks.");
}

export function normalizeTwilioPhoneOrNull(value: string | null | undefined) {
  const normalized = normalizeLinkPhone(value);
  if (!normalized) return null;
  const digits = normalized.replace(/[^\d]/g, "");
  if (digits.length < 7 || digits.length > 15) {
    return null;
  }
  return normalized;
}

function getAllowedCallerIds() {
  return new Set(
    (process.env.CALLS_TWILIO_ALLOWED_CALLER_IDS ?? "")
      .split(",")
      .map((value) => normalizeTwilioPhoneOrNull(value))
      .filter((value): value is string => Boolean(value))
  );
}

export function resolveTwilioCallerId(requestedFromPhone: string | null | undefined) {
  const fallback =
    normalizeTwilioPhoneOrNull(process.env.CALLS_TWILIO_FROM_NUMBER) ??
    normalizeTwilioPhoneOrNull(process.env.CALLS_PROVIDER_FROM_PHONE);
  if (!fallback) {
    throw new Error("CALLS_TWILIO_FROM_NUMBER is required for Twilio voice calls.");
  }

  const requested = normalizeTwilioPhoneOrNull(requestedFromPhone);
  if (!requested) {
    return fallback;
  }

  const allowed = getAllowedCallerIds();
  if (allowed.size === 0 || allowed.has(requested)) {
    return requested;
  }

  return fallback;
}

export function buildTwilioDialTwiML({
  bridgeTarget,
  callerId,
  recordingCallbackUrl
}: {
  bridgeTarget: string;
  callerId: string;
  recordingCallbackUrl: string;
}) {
  const escapeXml = (value: string) =>
    value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");

  const escapedCallerId = escapeXml(callerId);
  const escapedBridgeTarget = escapeXml(bridgeTarget);
  const escapedRecordingCallbackUrl = escapeXml(recordingCallbackUrl);
  const isClientTarget = bridgeTarget.startsWith("client:");
  const targetNode = isClientTarget
    ? `<Client>${escapeXml(bridgeTarget.slice("client:".length))}</Client>`
    : `<Number>${escapedBridgeTarget}</Number>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial answerOnBridge="true" callerId="${escapedCallerId}" record="record-from-answer-dual" recordingStatusCallback="${escapedRecordingCallbackUrl}" recordingStatusCallbackMethod="GET">
    ${targetNode}
  </Dial>
</Response>`;
}

export function getTwilioCredentials() {
  const accountSid = readString(process.env.CALLS_TWILIO_ACCOUNT_SID);
  const authToken = readString(process.env.CALLS_TWILIO_AUTH_TOKEN);
  if (!accountSid || !authToken) {
    throw new Error(
      "Twilio voice calls require CALLS_TWILIO_ACCOUNT_SID and CALLS_TWILIO_AUTH_TOKEN."
    );
  }
  return { accountSid, authToken };
}

export function getTwilioBridgeTarget() {
  const bridgeTarget = readString(process.env.CALLS_TWILIO_BRIDGE_TARGET);
  if (!bridgeTarget) {
    throw new Error("CALLS_TWILIO_BRIDGE_TARGET is required for Twilio voice calls.");
  }
  return bridgeTarget;
}

export function mapTwilioCallStatus(value: string | null | undefined): CallStatus | null {
  const normalized = readString(value)?.toLowerCase();
  switch (normalized) {
    case "queued":
      return "queued";
    case "initiated":
      return "dialing";
    case "ringing":
      return "ringing";
    case "in-progress":
      return "in_progress";
    case "completed":
      return "completed";
    case "no-answer":
      return "no_answer";
    case "busy":
      return "busy";
    case "failed":
      return "failed";
    case "canceled":
      return "canceled";
    default:
      return null;
  }
}

export function normalizeTwilioParams(params: URLSearchParams) {
  return Object.fromEntries(params.entries());
}

export function validateTwilioWebhook({
  pathname,
  requestUrl,
  signature,
  params
}: {
  pathname: string;
  requestUrl: string;
  signature: string | null | undefined;
  params: Record<string, string>;
}) {
  const { authToken } = getTwilioCredentials();
  const providedSignature = readString(signature);
  if (!providedSignature) {
    return false;
  }
  const validationUrl = buildTwilioPublicUrl(pathname, requestUrl);
  return twilio.validateRequest(authToken, providedSignature, validationUrl, params);
}

export function buildTwilioMediaFetchConfig(recordingUrl: string) {
  const { accountSid, authToken } = getTwilioCredentials();
  const upstreamUrl = /\.(mp3|wav)$/i.test(recordingUrl) ? recordingUrl : `${recordingUrl}.mp3`;
  return {
    url: upstreamUrl,
    headers: {
      Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`
    }
  };
}
