import { NextFetchEvent, NextRequest, NextResponse } from "next/server";
import {
  BACKOFFICE_ACCESS_EMAIL_HEADER,
  checkCloudflareAccessHeaders
} from "@6esk/auth/cloudflare-access";
import { applyRateLimit, rateLimitResponse } from "@/server/rate-limit-middleware";

const REQUEST_ID_HEADER = "x-6esk-request-id";
const REQUEST_ID_PATTERN = /^[a-zA-Z0-9._:-]{8,96}$/;
const BACKOFFICE_API_PREFIX = "/api/backoffice";

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
    requestHeaders.set(BACKOFFICE_ACCESS_EMAIL_HEADER, backofficeAccess.email);
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
