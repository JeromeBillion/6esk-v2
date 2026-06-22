import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { checkCloudflareAccessHeaders } from "@6esk/auth/cloudflare-access";

export async function middleware(request: NextRequest) {
  const access = await checkCloudflareAccessHeaders(request.headers);
  if (!access.ok) {
    return NextResponse.json({ error: access.reason }, { status: access.status });
  }

  const response = NextResponse.next();
  response.headers.set("x-sixesk-work-access-email", access.email);
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|new-logo-favicon-96.png).*)"]
};
