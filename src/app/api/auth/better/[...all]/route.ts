import { betterAuthNextHandlers, isBetterAuthRouteEnabled } from "@/server/auth/better-auth";
import { getBetterAuthReadiness } from "@/server/auth/better-auth-readiness";

function blockedResponse() {
  const readiness = getBetterAuthReadiness();
  if (!readiness.routeEnabled) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  return Response.json(
    {
      error: "Better Auth route is not ready",
      code: "better_auth_not_ready",
      blockers: readiness.blockers
    },
    { status: 503 }
  );
}

async function withReadiness(handler: (request: Request) => Promise<Response>, request: Request) {
  if (!isBetterAuthRouteEnabled()) {
    return blockedResponse();
  }
  return handler(request);
}

export function GET(request: Request) {
  return withReadiness(betterAuthNextHandlers.GET, request);
}

export function POST(request: Request) {
  return withReadiness(betterAuthNextHandlers.POST, request);
}

export function PATCH(request: Request) {
  return withReadiness(betterAuthNextHandlers.PATCH, request);
}

export function PUT(request: Request) {
  return withReadiness(betterAuthNextHandlers.PUT, request);
}

export function DELETE(request: Request) {
  return withReadiness(betterAuthNextHandlers.DELETE, request);
}
