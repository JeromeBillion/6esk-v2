export type RateLimitProfile = {
  id: string;
  envName: string;
  fallbackLimit: number;
};

type RateLimitRule = RateLimitProfile & {
  match: (pathname: string) => boolean;
};

const RATE_LIMIT_WINDOW_SECONDS = 60;
const RATE_LIMIT_KEY_PART_PATTERN = /^[a-zA-Z0-9._:-]{1,96}$/;

const RULES: RateLimitRule[] = [
  {
    id: "auth-login",
    envName: "RATE_LIMIT_AUTH_LOGIN",
    fallbackLimit: 20,
    match: (pathname) =>
      pathname === "/api/auth/login" ||
      pathname === "/api/auth/password-reset" ||
      pathname === "/api/auth/mfa/challenge" ||
      pathname === "/api/auth/mfa/enroll" ||
      pathname === "/api/auth/mfa/enroll/verify" ||
      pathname === "/api/auth/oauth/authorize" ||
      pathname === "/api/auth/oauth/callback"
  },
  {
    id: "portal-ticket",
    envName: "RATE_LIMIT_PORTAL_TICKET",
    fallbackLimit: 40,
    match: (pathname) => pathname === "/api/portal/tickets"
  },
  {
    id: "ticket-create",
    envName: "RATE_LIMIT_TICKET_CREATE",
    fallbackLimit: 60,
    match: (pathname) => pathname === "/api/tickets/create"
  },
  {
    id: "ticket-reply",
    envName: "RATE_LIMIT_TICKET_REPLY",
    fallbackLimit: 120,
    match: (pathname) => /^\/api\/tickets\/[^/]+\/replies$/.test(pathname)
  },
  {
    id: "draft-send",
    envName: "RATE_LIMIT_DRAFT_SEND",
    fallbackLimit: 120,
    match: (pathname) => /^\/api\/tickets\/[^/]+\/drafts\/[^/]+\/send$/.test(pathname)
  },
  {
    id: "email-send",
    envName: "RATE_LIMIT_EMAIL_SEND",
    fallbackLimit: 120,
    match: (pathname) => pathname === "/api/email/send"
  },
  {
    id: "whatsapp-resend",
    envName: "RATE_LIMIT_WHATSAPP_RESEND",
    fallbackLimit: 90,
    match: (pathname) => /^\/api\/messages\/[^/]+\/whatsapp-resend$/.test(pathname)
  },
  {
    id: "whatsapp-send",
    envName: "RATE_LIMIT_WHATSAPP_SEND",
    fallbackLimit: 120,
    match: (pathname) => pathname === "/api/whatsapp/send"
  },
  {
    id: "whatsapp-inbound",
    envName: "RATE_LIMIT_WHATSAPP_INBOUND",
    fallbackLimit: 1200,
    match: (pathname) => pathname === "/api/whatsapp/inbound"
  },
  {
    id: "calls-outbound",
    envName: "RATE_LIMIT_CALLS_OUTBOUND",
    fallbackLimit: 60,
    match: (pathname) => pathname === "/api/calls/outbound"
  },
  {
    id: "agent",
    envName: "RATE_LIMIT_AGENT",
    fallbackLimit: 600,
    match: (pathname) => pathname.startsWith("/api/agent/")
  },
  {
    id: "backoffice",
    envName: "RATE_LIMIT_BACKOFFICE",
    fallbackLimit: 180,
    match: (pathname) => pathname === "/api/backoffice" || pathname.startsWith("/api/backoffice/")
  },
  {
    id: "admin",
    envName: "RATE_LIMIT_ADMIN",
    fallbackLimit: 120,
    match: (pathname) => pathname.startsWith("/api/admin/")
  }
];

export function rateLimitWindowSeconds() {
  return RATE_LIMIT_WINDOW_SECONDS;
}

export function resolveRateLimitProfile(pathname: string): RateLimitProfile | null {
  const normalized = pathname.trim() || "/";
  const rule = RULES.find((item) => item.match(normalized));
  if (!rule) return null;
  return {
    id: rule.id,
    envName: rule.envName,
    fallbackLimit: rule.fallbackLimit
  };
}

export function readRateLimitValue(value: string | undefined, fallback: number) {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed)) return fallback;
  const normalized = Math.trunc(parsed);
  return normalized > 0 ? normalized : 0;
}

function normalizeRateLimitKeyPart(value: string | null | undefined) {
  const trimmed = value?.trim();
  if (!trimmed || !RATE_LIMIT_KEY_PART_PATTERN.test(trimmed)) return null;
  return trimmed;
}

function forwardedClientIdentity(headers: Headers) {
  return normalizeRateLimitKeyPart(headers.get("x-forwarded-for")?.split(",")[0]);
}

export function rateLimitIdentityFromHeaders(headers: Headers) {
  return (
    normalizeRateLimitKeyPart(headers.get("cf-connecting-ip")) ||
    normalizeRateLimitKeyPart(headers.get("x-real-ip")) ||
    forwardedClientIdentity(headers) ||
    "unknown"
  );
}

export function rateLimitTenantKeyFromHeaders(headers: Headers) {
  const tenant = normalizeRateLimitKeyPart(headers.get("x-6esk-tenant"));
  const workspace = normalizeRateLimitKeyPart(headers.get("x-6esk-workspace"));
  return tenant && workspace ? `${tenant}:${workspace}` : "unscoped";
}

export function buildRateLimitKey({
  profile,
  headers,
  trustTenantHeaders = false
}: {
  profile: RateLimitProfile;
  headers: Headers;
  trustTenantHeaders?: boolean;
}) {
  return [
    "rate-limit",
    profile.id,
    trustTenantHeaders ? rateLimitTenantKeyFromHeaders(headers) : "unscoped",
    rateLimitIdentityFromHeaders(headers)
  ].join(":");
}
