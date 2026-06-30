import { createRemoteJWKSet } from "jose/jwks/remote";
import { jwtVerify } from "jose/jwt/verify";

export type CloudflareAccessCheck =
  | {
      ok: true;
      email: string;
      assertion: string;
    }
  | {
      ok: false;
      status: number;
      reason: string;
    };

export const BACKOFFICE_ACCESS_EMAIL_HEADER = "x-sixesk-work-access-email";

const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function isEnabled(value: string | undefined) {
  const normalized = value?.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function normalizeTeamDomain(value: string | undefined) {
  const trimmed = value?.trim().replace(/\/+$/, "");
  if (!trimmed) return null;
  return trimmed.startsWith("https://") ? trimmed : `https://${trimmed}`;
}

function readHeader(headers: Headers, name: string) {
  return headers.get(name)?.trim() || null;
}

export function shouldRequireCloudflareAccess(env: NodeJS.ProcessEnv = process.env) {
  return env.NODE_ENV === "production" && isEnabled(env.BACKOFFICE_REQUIRE_CLOUDFLARE_ACCESS);
}

function jwksForTeamDomain(teamDomain: string) {
  const existing = jwksCache.get(teamDomain);
  if (existing) return existing;
  const jwks = createRemoteJWKSet(new URL(`${teamDomain}/cdn-cgi/access/certs`));
  jwksCache.set(teamDomain, jwks);
  return jwks;
}

export async function checkCloudflareAccessHeaders(
  headers: Headers,
  env: NodeJS.ProcessEnv = process.env
): Promise<CloudflareAccessCheck> {
  if (!shouldRequireCloudflareAccess(env)) {
    return {
      ok: true,
      email: readHeader(headers, "cf-access-authenticated-user-email") ?? "local-dev@6esk.internal",
      assertion: readHeader(headers, "cf-access-jwt-assertion") ?? "local-dev"
    };
  }

  if (!env.CLOUDFLARE_ACCESS_AUD?.trim()) {
    return {
      ok: false,
      status: 503,
      reason: "CLOUDFLARE_ACCESS_AUD is required when backoffice Cloudflare Access enforcement is enabled."
    };
  }

  const teamDomain = normalizeTeamDomain(env.CLOUDFLARE_ACCESS_TEAM_DOMAIN);
  if (!teamDomain) {
    return {
      ok: false,
      status: 503,
      reason: "CLOUDFLARE_ACCESS_TEAM_DOMAIN is required when backoffice Cloudflare Access enforcement is enabled."
    };
  }

  const email = readHeader(headers, "cf-access-authenticated-user-email");
  const assertion = readHeader(headers, "cf-access-jwt-assertion");
  if (!email || !assertion) {
    return {
      ok: false,
      status: 403,
      reason: "Cloudflare Access identity headers are required for 6esk Work."
    };
  }

  try {
    const { payload } = await jwtVerify(assertion, jwksForTeamDomain(teamDomain), {
      issuer: teamDomain,
      audience: env.CLOUDFLARE_ACCESS_AUD
    });
    const tokenEmail = typeof payload.email === "string" ? payload.email.trim() : "";
    if (tokenEmail && tokenEmail.toLowerCase() !== email.toLowerCase()) {
      return {
        ok: false,
        status: 403,
        reason: "Cloudflare Access email header does not match the verified token."
      };
    }
    return { ok: true, email: tokenEmail || email, assertion };
  } catch {
    return {
      ok: false,
      status: 403,
      reason: "Cloudflare Access JWT could not be verified for this application."
    };
  }
}
