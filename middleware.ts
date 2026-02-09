import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

type RateEntry = {
  count: number;
  resetAt: number;
};

const store = new Map<string, RateEntry>();
const ADMIN_LIMIT = 120;
const AGENT_LIMIT = 600;
const AUTH_LIMIT = 20;
const PORTAL_LIMIT = 40;
const TICKET_CREATE_LIMIT = 60;
const EMAIL_SEND_LIMIT = 120;
const WINDOW_MS = 60_000;

function getClientKey(request: NextRequest) {
  const forwarded = request.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() || request.ip || "unknown";
  return ip;
}

function parseAllowlist(value?: string | null) {
  if (!value) return null;
  const list = value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return list.length ? list : null;
}

function isAllowedIp(ip: string, allowlist: string[] | null) {
  if (!allowlist) return true;
  return allowlist.includes(ip);
}

function checkRateLimit(key: string, limit: number) {
  const now = Date.now();
  const entry = store.get(key);
  if (!entry || now > entry.resetAt) {
    store.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return { allowed: true, resetAt: now + WINDOW_MS, remaining: limit - 1 };
  }

  if (entry.count >= limit) {
    return { allowed: false, resetAt: entry.resetAt, remaining: 0 };
  }

  entry.count += 1;
  return { allowed: true, resetAt: entry.resetAt, remaining: limit - entry.count };
}

type RateBucket = {
  key: string;
  limit: number;
  type: "admin" | "agent" | "auth" | "portal" | "ticket_create" | "email_send";
};

function getRateBucket(pathname: string): RateBucket | null {
  if (pathname.startsWith("/api/admin")) {
    return { key: "admin", limit: ADMIN_LIMIT, type: "admin" };
  }
  if (pathname.startsWith("/api/agent")) {
    return { key: "agent", limit: AGENT_LIMIT, type: "agent" };
  }
  if (pathname === "/api/auth/login") {
    return { key: "auth_login", limit: AUTH_LIMIT, type: "auth" };
  }
  if (pathname === "/api/portal/tickets") {
    return { key: "portal_ticket", limit: PORTAL_LIMIT, type: "portal" };
  }
  if (pathname === "/api/tickets/create") {
    return { key: "ticket_create", limit: TICKET_CREATE_LIMIT, type: "ticket_create" };
  }
  if (pathname === "/api/email/send") {
    return { key: "email_send", limit: EMAIL_SEND_LIMIT, type: "email_send" };
  }
  return null;
}

export function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const bucket = getRateBucket(pathname);
  if (!bucket) {
    return NextResponse.next();
  }

  const ip = getClientKey(request);
  const adminAllowlist = parseAllowlist(process.env.ADMIN_IP_ALLOWLIST);
  const agentAllowlist = parseAllowlist(process.env.AGENT_IP_ALLOWLIST);

  if (bucket.type === "admin" && !isAllowedIp(ip, adminAllowlist)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (bucket.type === "agent" && !isAllowedIp(ip, agentAllowlist)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const key = `${bucket.key}:${ip}`;
  const result = checkRateLimit(key, bucket.limit);

  if (!result.allowed) {
    const retryAfter = Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000));
    return NextResponse.json(
      { error: "Rate limit exceeded", retryAfter },
      {
        status: 429,
        headers: {
          "Retry-After": retryAfter.toString()
        }
      }
    );
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/api/admin/:path*",
    "/api/agent/:path*",
    "/api/auth/login",
    "/api/portal/tickets",
    "/api/tickets/create",
    "/api/email/send"
  ]
};
