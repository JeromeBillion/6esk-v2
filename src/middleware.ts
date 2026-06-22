import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis/cloudflare";
import { NextFetchEvent, NextRequest, NextResponse } from "next/server";
import { checkCloudflareAccessHeaders } from "@6esk/auth/cloudflare-access";
import {
  buildRateLimitKey,
  rateLimitWindowSeconds,
  readRateLimitValue,
  resolveRateLimitProfile
} from "@/server/rate-limit";

type MemoryEntry = {
  count: number;
  resetAt: number;
};

type RateLimitResult = {
  success: boolean;
  limit: number;
  remaining: number;
  reset: number;
  pending?: Promise<unknown>;
};

const REQUEST_ID_HEADER = "x-6esk-request-id";
const REQUEST_ID_PATTERN = /^[a-zA-Z0-9._:-]{8,96}$/;
const BACKOFFICE_API_PREFIX = "/api/backoffice";

declare global {
  // eslint-disable-next-line no-var
  var __sixeskRateLimitMemory: Map<string, MemoryEntry> | undefined;
}

const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? Redis.fromEnv()
    : null;
const upstashLimiters = new Map<string, Ratelimit>();

function getMemoryStore() {
  globalThis.__sixeskRateLimitMemory ??= new Map<string, MemoryEntry>();
  return globalThis.__sixeskRateLimitMemory;
}

function getUpstashLimiter(profileId: string, limit: number) {
  if (!redis) return null;
  const cacheKey = `${profileId}:${limit}`;
  const existing = upstashLimiters.get(cacheKey);
  if (existing) return existing;

  const limiter = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(limit, `${rateLimitWindowSeconds()} s`),
    analytics: false,
    prefix: `6esk:${profileId}`
  });
  upstashLimiters.set(cacheKey, limiter);
  return limiter;
}

function memoryLimit(key: string, limit: number): RateLimitResult {
  const now = Date.now();
  const windowMs = rateLimitWindowSeconds() * 1000;
  const store = getMemoryStore();
  const current = store.get(key);
  const entry = current && current.resetAt > now ? current : { count: 0, resetAt: now + windowMs };
  entry.count += 1;
  store.set(key, entry);

  return {
    success: entry.count <= limit,
    limit,
    remaining: Math.max(0, limit - entry.count),
    reset: entry.resetAt
  };
}

export function normalizeRequestIdForMiddleware(value: string | null | undefined) {
  const trimmed = value?.trim();
  if (!trimmed || !REQUEST_ID_PATTERN.test(trimmed)) return null;
  return trimmed;
}

function generateRequestId() {
  return globalThis.crypto?.randomUUID?.() ?? `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function requestIdFromHeaders(headers: Headers) {
  return (
    normalizeRequestIdForMiddleware(headers.get(REQUEST_ID_HEADER)) ??
    normalizeRequestIdForMiddleware(headers.get("x-request-id")) ??
    generateRequestId()
  );
}

function withRequestId(response: NextResponse, requestId: string) {
  response.headers.set(REQUEST_ID_HEADER, requestId);
  return response;
}

export function isBackofficeApiPath(pathname: string) {
  return pathname === BACKOFFICE_API_PREFIX || pathname.startsWith(`${BACKOFFICE_API_PREFIX}/`);
}

async function applyBackofficeAccess(request: NextRequest) {
  if (!isBackofficeApiPath(request.nextUrl.pathname)) {
    return null;
  }

  const access = await checkCloudflareAccessHeaders(request.headers);
  if (!access.ok) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: access.reason }, { status: access.status })
    };
  }

  return {
    ok: true as const,
    email: access.email
  };
}

async function applyRateLimit(request: NextRequest): Promise<RateLimitResult | null> {
  if (request.method === "OPTIONS") {
    return null;
  }

  const profile = resolveRateLimitProfile(request.nextUrl.pathname);
  if (!profile) {
    return null;
  }

  const limit = readRateLimitValue(process.env[profile.envName], profile.fallbackLimit);
  if (limit === 0) {
    return null;
  }

  const key = buildRateLimitKey({ profile, headers: request.headers });
  const limiter = getUpstashLimiter(profile.id, limit);
  if (!limiter) {
    if (process.env.NODE_ENV === "production") {
      return {
        success: false,
        limit,
        remaining: 0,
        reset: Date.now() + rateLimitWindowSeconds() * 1000
      };
    }
    return memoryLimit(key, limit);
  }

  return limiter.limit(key);
}

function rateLimitResponse(result: RateLimitResult) {
  const retryAfter = Math.max(1, Math.ceil((result.reset - Date.now()) / 1000));
  return NextResponse.json(
    {
      error: "Too many requests",
      code: "rate_limited",
      retryAfterSeconds: retryAfter
    },
    {
      status: 429,
      headers: {
        "Retry-After": String(retryAfter),
        "X-RateLimit-Limit": String(result.limit),
        "X-RateLimit-Remaining": String(result.remaining),
        "X-RateLimit-Reset": String(result.reset)
      }
    }
  );
}

export async function middleware(request: NextRequest, event: NextFetchEvent) {
  const requestId = requestIdFromHeaders(request.headers);
  const result = await applyRateLimit(request);
  if (result?.pending) {
    event.waitUntil(result.pending);
  }
  if (result && !result.success) {
    return withRequestId(rateLimitResponse(result), requestId);
  }

  const backofficeAccess = await applyBackofficeAccess(request);
  if (backofficeAccess && !backofficeAccess.ok) {
    return withRequestId(backofficeAccess.response, requestId);
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(REQUEST_ID_HEADER, requestId);
  if (backofficeAccess?.ok) {
    requestHeaders.set("x-sixesk-work-access-email", backofficeAccess.email);
  }
  return withRequestId(
    NextResponse.next({
      request: {
        headers: requestHeaders
      }
    }),
    requestId
  );
}

export const config = {
  matcher: ["/api/:path*"]
};
