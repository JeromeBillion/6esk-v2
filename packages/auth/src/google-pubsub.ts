import { createRemoteJWKSet } from "jose/jwks/remote";
import { jwtVerify } from "jose/jwt/verify";

export type GooglePubSubPushCheck =
  | {
      ok: true;
      tokenEmail: string | null;
      tokenSubject: string | null;
    }
  | {
      ok: false;
      status: number;
      reason: string;
    };

const GOOGLE_OIDC_CERTS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const GOOGLE_ISSUERS = new Set(["accounts.google.com", "https://accounts.google.com"]);
let googleJwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function isEnabled(value: string | undefined) {
  const normalized = value?.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function readBearerToken(headers: Headers) {
  const authorization = headers.get("authorization")?.trim();
  if (!authorization) return null;
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

function jwks() {
  googleJwks ??= createRemoteJWKSet(new URL(GOOGLE_OIDC_CERTS_URL));
  return googleJwks;
}

function readEmailClaim(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() || null : null;
}

export function shouldRequireGooglePubSubPushAuth(env: NodeJS.ProcessEnv = process.env) {
  return env.NODE_ENV === "production" || isEnabled(env.GOOGLE_PUBSUB_REQUIRE_AUTH);
}

export function expectedGooglePubSubSubscription(env: NodeJS.ProcessEnv = process.env) {
  return env.GOOGLE_PUBSUB_SUBSCRIPTION?.trim() || null;
}

export function checkGooglePubSubSubscription(
  actualSubscription: unknown,
  env: NodeJS.ProcessEnv = process.env
): GooglePubSubPushCheck {
  const expected = expectedGooglePubSubSubscription(env);
  if (!expected) {
    return { ok: true, tokenEmail: null, tokenSubject: null };
  }
  if (actualSubscription !== expected) {
    return {
      ok: false,
      status: 403,
      reason: "Google Pub/Sub subscription does not match the configured webhook subscription."
    };
  }
  return { ok: true, tokenEmail: null, tokenSubject: null };
}

export async function checkGooglePubSubPushHeaders(
  headers: Headers,
  env: NodeJS.ProcessEnv = process.env
): Promise<GooglePubSubPushCheck> {
  if (!shouldRequireGooglePubSubPushAuth(env)) {
    return { ok: true, tokenEmail: "local-dev@6esk.internal", tokenSubject: "local-dev" };
  }

  const audience = env.GOOGLE_PUBSUB_PUSH_AUDIENCE?.trim();
  if (!audience) {
    return {
      ok: false,
      status: 503,
      reason: "GOOGLE_PUBSUB_PUSH_AUDIENCE is required when Google Pub/Sub push auth is enabled."
    };
  }

  const token = readBearerToken(headers);
  if (!token) {
    return {
      ok: false,
      status: 403,
      reason: "Google Pub/Sub push Authorization bearer token is required."
    };
  }

  try {
    const { payload } = await jwtVerify(token, jwks(), { audience });
    if (!GOOGLE_ISSUERS.has(String(payload.iss ?? ""))) {
      return {
        ok: false,
        status: 403,
        reason: "Google Pub/Sub push token issuer is not trusted."
      };
    }

    const tokenEmail = readEmailClaim(payload.email);
    const expectedEmail = readEmailClaim(env.GOOGLE_PUBSUB_PUSH_SERVICE_ACCOUNT_EMAIL);
    if (expectedEmail && tokenEmail !== expectedEmail) {
      return {
        ok: false,
        status: 403,
        reason: "Google Pub/Sub push token service account does not match configuration."
      };
    }
    if (payload.email_verified === false) {
      return {
        ok: false,
        status: 403,
        reason: "Google Pub/Sub push token email is not verified."
      };
    }

    return {
      ok: true,
      tokenEmail,
      tokenSubject: typeof payload.sub === "string" ? payload.sub : null
    };
  } catch {
    return {
      ok: false,
      status: 403,
      reason: "Google Pub/Sub push token could not be verified."
    };
  }
}
