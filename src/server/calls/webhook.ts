import { createHmac, timingSafeEqual } from "crypto";
import { canAcceptUnsignedWebhookTraffic } from "@/server/security/webhooks";

export type CallWebhookAuthResult = {
  authorized: boolean;
  mode: "hmac" | "shared_secret" | "open";
  reason:
    | "ok"
    | "missing_signature"
    | "invalid_signature"
    | "missing_timestamp"
    | "invalid_timestamp"
    | "timestamp_out_of_window"
    | "invalid_shared_secret"
    | "unsecured_mode";
};

function normalizeSignature(value: string | null | undefined) {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.toLowerCase().startsWith("sha256=") ? trimmed : `sha256=${trimmed}`;
}

function buildSignedPayload(body: string, timestamp: string | null | undefined) {
  const trimmedTimestamp = timestamp?.trim();
  if (!trimmedTimestamp) {
    return body;
  }
  return `${trimmedTimestamp}.${body}`;
}

export function buildCallWebhookSignature(
  body: string,
  secret: string,
  timestamp?: string | null
) {
  const digest = createHmac("sha256", secret)
    .update(buildSignedPayload(body, timestamp))
    .digest("hex");
  return `sha256=${digest}`;
}

function parseTimestamp(value: string | null | undefined) {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (/^\d+$/.test(trimmed)) {
    const numeric = Number(trimmed);
    if (!Number.isFinite(numeric)) return null;
    return new Date(numeric < 1e12 ? numeric * 1000 : numeric);
  }

  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isTimestampWithinSkew(
  providedTimestamp: string | null | undefined,
  maxSkewSeconds: number
) {
  const parsed = parseTimestamp(providedTimestamp);
  if (!parsed) return false;
  const deltaMs = Math.abs(Date.now() - parsed.getTime());
  return deltaMs <= maxSkewSeconds * 1000;
}

function getMaxSkewSeconds() {
  const configured = Number(process.env.CALLS_WEBHOOK_MAX_SKEW_SECONDS ?? "300");
  if (!Number.isFinite(configured) || configured < 0) {
    return 300;
  }
  return Math.floor(configured);
}

function allowLegacyBodySignature() {
  const configured = (process.env.CALLS_WEBHOOK_ALLOW_LEGACY_BODY_SIGNATURE ?? "").trim();
  if (!configured) {
    return false;
  }
  return /^(1|true|yes|on)$/i.test(configured);
}

export function getCallWebhookSecurityConfig() {
  const hasHmac = Boolean((process.env.CALLS_WEBHOOK_SECRET ?? "").trim());
  const hasSharedSecret = Boolean((process.env.INBOUND_SHARED_SECRET ?? "").trim());
  const maxSkewSeconds = getMaxSkewSeconds();
  const legacyBodySignature = hasHmac && maxSkewSeconds > 0 && allowLegacyBodySignature();

  return {
    mode: hasHmac ? "hmac" : hasSharedSecret ? "shared_secret" : "open",
    timestampRequired: hasHmac && maxSkewSeconds > 0,
    maxSkewSeconds: hasHmac ? maxSkewSeconds : 0,
    legacyBodySignature
  } as const;
}

function verifyHmac({
  body,
  providedSignature,
  secret,
  signedTimestamp
}: {
  body: string;
  providedSignature: string | null | undefined;
  secret: string;
  signedTimestamp?: string | null | undefined;
}) {
  const normalizedProvided = normalizeSignature(providedSignature);
  if (!normalizedProvided) return false;
  const expected = buildCallWebhookSignature(body, secret, signedTimestamp);
  const expectedBuffer = Buffer.from(expected, "utf8");
  const providedBuffer = Buffer.from(normalizedProvided, "utf8");
  if (expectedBuffer.length !== providedBuffer.length) {
    return false;
  }
  return timingSafeEqual(expectedBuffer, providedBuffer);
}

export function authorizeCallWebhook({
  rawBody,
  providedSignature,
  providedSecret,
  providedTimestamp
}: {
  rawBody: string;
  providedSignature: string | null | undefined;
  providedSecret: string | null | undefined;
  providedTimestamp?: string | null | undefined;
}): CallWebhookAuthResult {
  const webhookSecret = process.env.CALLS_WEBHOOK_SECRET ?? "";
  if (webhookSecret) {
    const maxSkewSeconds = getMaxSkewSeconds();
    const timestampForChecks = providedTimestamp?.trim() || null;
    if (maxSkewSeconds > 0) {
      if (!timestampForChecks) {
        return { authorized: false, mode: "hmac", reason: "missing_timestamp" };
      }

      const parsed = parseTimestamp(timestampForChecks);
      if (!parsed) {
        return { authorized: false, mode: "hmac", reason: "invalid_timestamp" };
      }

      if (!isTimestampWithinSkew(timestampForChecks, maxSkewSeconds)) {
        return {
          authorized: false,
          mode: "hmac",
          reason: "timestamp_out_of_window"
        };
      }
    }

    if (!normalizeSignature(providedSignature)) {
      return { authorized: false, mode: "hmac", reason: "missing_signature" };
    }
    const signatureValid = verifyHmac({
      body: rawBody,
      providedSignature,
      secret: webhookSecret,
      signedTimestamp: maxSkewSeconds > 0 ? timestampForChecks : null
    });
    if (!signatureValid) {
      if (maxSkewSeconds > 0 && allowLegacyBodySignature()) {
        const legacyValid = verifyHmac({
          body: rawBody,
          providedSignature,
          secret: webhookSecret
        });
        if (legacyValid) {
          return { authorized: true, mode: "hmac", reason: "ok" };
        }
      }
      return { authorized: false, mode: "hmac", reason: "invalid_signature" };
    }

    return { authorized: true, mode: "hmac", reason: "ok" };
  }

  const sharedSecret = process.env.INBOUND_SHARED_SECRET ?? "";
  if (sharedSecret) {
    if (providedSecret !== sharedSecret) {
      return { authorized: false, mode: "shared_secret", reason: "invalid_shared_secret" };
    }
    return { authorized: true, mode: "shared_secret", reason: "ok" };
  }

  if (!canAcceptUnsignedWebhookTraffic(process.env.CALLS_WEBHOOK_ALLOW_UNAUTHENTICATED)) {
    return { authorized: false, mode: "open", reason: "unsecured_mode" };
  }

  return { authorized: true, mode: "open", reason: "unsecured_mode" };
}

export function isCallWebhookAuthorized({
  rawBody,
  providedSignature,
  providedSecret,
  providedTimestamp
}: {
  rawBody: string;
  providedSignature: string | null | undefined;
  providedSecret: string | null | undefined;
  providedTimestamp?: string | null | undefined;
}) {
  return authorizeCallWebhook({
    rawBody,
    providedSignature,
    providedSecret,
    providedTimestamp
  }).authorized;
}
