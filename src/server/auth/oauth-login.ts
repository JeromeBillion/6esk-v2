import { randomBytes } from "crypto";
import { getEnv } from "@/server/env";

export const AUTH_OAUTH_PROVIDERS = ["google", "microsoft"] as const;
export type AuthOAuthProvider = (typeof AUTH_OAUTH_PROVIDERS)[number];

export type AuthOAuthState = {
  provider: AuthOAuthProvider;
  nonce: string;
  returnTo: string;
  issuedAt: number;
};

export type AuthOAuthTokens = {
  accessToken: string;
  expiresIn: number | null;
};

export type AuthOAuthProfile = {
  provider: AuthOAuthProvider;
  providerAccountId: string;
  email: string;
  emailVerified: boolean | null;
};

const STATE_MAX_AGE_MS = 10 * 60 * 1000;
const GOOGLE_LOGIN_SCOPES = ["openid", "email", "profile"].join(" ");
const MICROSOFT_LOGIN_SCOPES = ["openid", "profile", "email", "User.Read"].join(" ");

export function isAuthOAuthProvider(value: string | null | undefined): value is AuthOAuthProvider {
  return AUTH_OAUTH_PROVIDERS.includes(value as AuthOAuthProvider);
}

export function sanitizeAuthReturnTo(value: string | null | undefined, fallback = "/tickets") {
  const raw = value?.trim();
  if (!raw || raw.length > 512) return fallback;
  try {
    const parsed = new URL(raw, "https://6esk.local");
    if (parsed.origin !== "https://6esk.local") return fallback;
    if (!parsed.pathname.startsWith("/") || parsed.pathname.startsWith("//")) return fallback;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}

export function createAuthOAuthState(provider: AuthOAuthProvider, returnTo: string) {
  const state: AuthOAuthState = {
    provider,
    nonce: randomBytes(32).toString("base64url"),
    returnTo: sanitizeAuthReturnTo(returnTo),
    issuedAt: Date.now()
  };
  return {
    state,
    encoded: Buffer.from(JSON.stringify(state), "utf8").toString("base64url")
  };
}

export function parseAuthOAuthState(value: string | null | undefined): AuthOAuthState | null {
  if (!value || value.length > 2048) return null;
  try {
    const decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<AuthOAuthState>;
    if (!isAuthOAuthProvider(decoded.provider)) return null;
    if (typeof decoded.nonce !== "string" || decoded.nonce.length < 32) return null;
    if (typeof decoded.issuedAt !== "number" || Date.now() - decoded.issuedAt > STATE_MAX_AGE_MS) return null;
    return {
      provider: decoded.provider,
      nonce: decoded.nonce,
      returnTo: sanitizeAuthReturnTo(decoded.returnTo),
      issuedAt: decoded.issuedAt
    };
  } catch {
    return null;
  }
}

function requireAuthConfig(provider: AuthOAuthProvider) {
  const env = getEnv();
  if (provider === "google") {
    const clientId = env.GOOGLE_AUTH_CLIENT_ID?.trim();
    const clientSecret = env.GOOGLE_AUTH_CLIENT_SECRET?.trim();
    const redirectUri = env.GOOGLE_AUTH_REDIRECT_URI?.trim();
    if (!clientId || !clientSecret || !redirectUri) {
      throw new Error("Google auth login is not configured.");
    }
    return { clientId, clientSecret, redirectUri, tenantId: null };
  }

  const clientId = env.MICROSOFT_AUTH_CLIENT_ID?.trim();
  const clientSecret = env.MICROSOFT_AUTH_CLIENT_SECRET?.trim();
  const redirectUri = env.MICROSOFT_AUTH_REDIRECT_URI?.trim();
  const tenantId = env.MICROSOFT_AUTH_TENANT_ID?.trim() || "common";
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error("Microsoft auth login is not configured.");
  }
  return { clientId, clientSecret, redirectUri, tenantId };
}

export function buildAuthOAuthAuthorizeUrl(provider: AuthOAuthProvider, state: string) {
  const config = requireAuthConfig(provider);
  if (provider === "google") {
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.searchParams.set("client_id", config.clientId);
    url.searchParams.set("redirect_uri", config.redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", GOOGLE_LOGIN_SCOPES);
    url.searchParams.set("prompt", "select_account");
    url.searchParams.set("state", state);
    return url.toString();
  }

  const url = new URL(`https://login.microsoftonline.com/${config.tenantId}/oauth2/v2.0/authorize`);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", MICROSOFT_LOGIN_SCOPES);
  url.searchParams.set("response_mode", "query");
  url.searchParams.set("prompt", "select_account");
  url.searchParams.set("state", state);
  return url.toString();
}

export async function exchangeAuthOAuthCode(provider: AuthOAuthProvider, code: string): Promise<AuthOAuthTokens> {
  const config = requireAuthConfig(provider);
  const tokenUrl =
    provider === "google"
      ? "https://oauth2.googleapis.com/token"
      : `https://login.microsoftonline.com/${config.tenantId}/oauth2/v2.0/token`;

  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: config.redirectUri
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${provider} auth token exchange failed: ${body}`);
  }

  const data = (await response.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) {
    throw new Error(`${provider} auth token response did not include an access token.`);
  }
  return {
    accessToken: data.access_token,
    expiresIn: typeof data.expires_in === "number" ? data.expires_in : null
  };
}

export async function fetchAuthOAuthProfile(
  provider: AuthOAuthProvider,
  accessToken: string
): Promise<AuthOAuthProfile> {
  if (provider === "google") {
    const response = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (!response.ok) {
      throw new Error(`Failed to fetch Google auth profile: ${await response.text()}`);
    }
    const data = (await response.json()) as {
      sub?: string;
      email?: string;
      email_verified?: boolean;
    };
    if (!data.sub || !data.email) {
      throw new Error("Google auth profile is missing subject or email.");
    }
    return {
      provider,
      providerAccountId: data.sub,
      email: data.email.toLowerCase(),
      emailVerified: data.email_verified ?? null
    };
  }

  const response = await fetch("https://graph.microsoft.com/v1.0/me", {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch Microsoft auth profile: ${await response.text()}`);
  }
  const data = (await response.json()) as {
    id?: string;
    mail?: string | null;
    userPrincipalName?: string | null;
  };
  const email = data.mail || data.userPrincipalName;
  if (!data.id || !email) {
    throw new Error("Microsoft auth profile is missing id or email.");
  }
  return {
    provider,
    providerAccountId: data.id,
    email: email.toLowerCase(),
    emailVerified: null
  };
}
