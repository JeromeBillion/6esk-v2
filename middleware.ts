import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

type RateEntry = {
  count: number;
  resetAt: number;
};

// ⚠️ KNOWN LIMITATION: Without Upstash Redis configured, this rate limit
// store is per-process and will NOT be shared across multiple replicas or 
// Vercel Edge instances. For production, configure UPSTASH_REDIS_REST_URL
// to enable the distributed Redis caching.
const store = new Map<string, RateEntry>();
const WINDOW_MS = 60_000;
const GC_INTERVAL_MS = 5 * 60_000; // Sweep expired entries every 5 minutes

// Periodic garbage collection to prevent unbounded memory growth.
// Expired entries are safe to remove since they will be recreated on
// the next request with a fresh window.
let lastGcAt = Date.now();
function maybeGarbageCollect() {
  const now = Date.now();
  if (now - lastGcAt < GC_INTERVAL_MS) {
    return;
  }
  lastGcAt = now;
  for (const [key, entry] of store) {
    if (now > entry.resetAt) {
      store.delete(key);
    }
  }
}

function parseLimit(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback;
  }
  return Math.trunc(parsed);
}

const ADMIN_LIMIT = parseLimit(process.env.RATE_LIMIT_ADMIN, 120);
const AGENT_LIMIT = parseLimit(process.env.RATE_LIMIT_AGENT, 600);
const AUTH_LIMIT = parseLimit(process.env.RATE_LIMIT_AUTH_LOGIN, 20);
const PORTAL_LIMIT = parseLimit(process.env.RATE_LIMIT_PORTAL_TICKET, 40);
const TICKET_CREATE_LIMIT = parseLimit(process.env.RATE_LIMIT_TICKET_CREATE, 60);
const TICKET_REPLY_LIMIT = parseLimit(process.env.RATE_LIMIT_TICKET_REPLY, 120);
const TICKET_DRAFT_SEND_LIMIT = parseLimit(process.env.RATE_LIMIT_DRAFT_SEND, 120);
const EMAIL_SEND_LIMIT = parseLimit(process.env.RATE_LIMIT_EMAIL_SEND, 120);
const WHATSAPP_SEND_LIMIT = parseLimit(process.env.RATE_LIMIT_WHATSAPP_SEND, 120);
const WHATSAPP_RESEND_LIMIT = parseLimit(process.env.RATE_LIMIT_WHATSAPP_RESEND, 90);
const WHATSAPP_INBOUND_LIMIT = parseLimit(process.env.RATE_LIMIT_WHATSAPP_INBOUND, 1200);

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

function checkRateLimitLocal(key: string, limit: number) {
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
  type:
    | "admin"
    | "agent"
    | "auth"
    | "auth_password_reset"
    | "portal"
    | "ticket_create"
    | "ticket_reply"
    | "draft_send"
    | "email_send"
    | "whatsapp_send"
    | "whatsapp_resend"
    | "whatsapp_inbound";
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
  if (pathname === "/api/auth/password-reset") {
    return { key: "auth_password_reset", limit: AUTH_LIMIT, type: "auth_password_reset" };
  }
  if (pathname === "/api/portal/tickets") {
    return { key: "portal_ticket", limit: PORTAL_LIMIT, type: "portal" };
  }
  if (pathname === "/api/tickets/create") {
    return { key: "ticket_create", limit: TICKET_CREATE_LIMIT, type: "ticket_create" };
  }
  if (/^\/api\/tickets\/[^/]+\/replies$/.test(pathname)) {
    return { key: "ticket_reply", limit: TICKET_REPLY_LIMIT, type: "ticket_reply" };
  }
  if (/^\/api\/tickets\/[^/]+\/drafts\/[^/]+\/send$/.test(pathname)) {
    return { key: "draft_send", limit: TICKET_DRAFT_SEND_LIMIT, type: "draft_send" };
  }
  if (pathname === "/api/email/send") {
    return { key: "email_send", limit: EMAIL_SEND_LIMIT, type: "email_send" };
  }
  if (pathname === "/api/whatsapp/send") {
    return { key: "whatsapp_send", limit: WHATSAPP_SEND_LIMIT, type: "whatsapp_send" };
  }
  if (/^\/api\/messages\/[^/]+\/whatsapp-resend$/.test(pathname)) {
    return { key: "whatsapp_resend", limit: WHATSAPP_RESEND_LIMIT, type: "whatsapp_resend" };
  }
  if (pathname === "/api/whatsapp/inbound") {
    return { key: "whatsapp_inbound", limit: WHATSAPP_INBOUND_LIMIT, type: "whatsapp_inbound" };
  }
  return null;
}

// Initialize Upstash Redis only if configured
const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN
      })
    : null;

// Cache instantiated limiters
const limiters = new Map<number, Ratelimit>();
function getLimiter(limit: number) {
  let limiter = limiters.get(limit);
  if (!limiter && redis) {
    limiter = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(limit, "60 s"),
      analytics: false
    });
    limiters.set(limit, limiter);
  }
  return limiter;
}

export async function middleware(request: NextRequest) {
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
  const limiter = getLimiter(bucket.limit);

  let allowed = true;
  let resetAt = 0;

  if (limiter) {
    // Distributed Rate Limit via Upstash
    const result = await limiter.limit(key);
    allowed = result.success;
    resetAt = result.reset;
  } else {
    // Local In-Memory Fallback
    maybeGarbageCollect();
    const result = checkRateLimitLocal(key, bucket.limit);
    allowed = result.allowed;
    resetAt = result.resetAt;
  }

  if (!allowed) {
    const retryAfter = Math.max(1, Math.ceil((resetAt - Date.now()) / 1000));
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
    "/api/auth/password-reset",
    "/api/portal/tickets",
    "/api/tickets/:path*",
    "/api/email/send",
    "/api/whatsapp/send",
    "/api/whatsapp/inbound",
    "/api/messages/:path*"
  ]
};
