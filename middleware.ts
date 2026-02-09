import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

type RateEntry = {
  count: number;
  resetAt: number;
};

const store = new Map<string, RateEntry>();
const ADMIN_LIMIT = 120;
const AGENT_LIMIT = 600;
const WINDOW_MS = 60_000;

function getClientKey(request: NextRequest) {
  const forwarded = request.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() || request.ip || "unknown";
  return ip;
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

export function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  if (!pathname.startsWith("/api/admin") && !pathname.startsWith("/api/agent")) {
    return NextResponse.next();
  }

  const limit = pathname.startsWith("/api/admin") ? ADMIN_LIMIT : AGENT_LIMIT;
  const key = `${pathname.startsWith("/api/admin") ? "admin" : "agent"}:${getClientKey(request)}`;
  const result = checkRateLimit(key, limit);

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
  matcher: ["/api/admin/:path*", "/api/agent/:path*"]
};
