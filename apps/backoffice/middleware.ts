import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  BACKOFFICE_ACCESS_EMAIL_HEADER,
  checkCloudflareAccessHeaders
} from "@6esk/auth/cloudflare-access";

export async function middleware(request: NextRequest) {
  const access = await checkCloudflareAccessHeaders(request.headers);
  if (!access.ok) {
    return NextResponse.json({ error: access.reason }, { status: access.status });
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(BACKOFFICE_ACCESS_EMAIL_HEADER, access.email);
  const response = NextResponse.next({
    request: {
      headers: requestHeaders
    }
  });
  response.headers.set(BACKOFFICE_ACCESS_EMAIL_HEADER, access.email);
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|new-logo-favicon-96.png).*)"]
};
