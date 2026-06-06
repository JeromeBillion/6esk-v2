import { getPublicAuthProviders } from "@/server/auth/better-auth";
import { getBetterAuthReadiness } from "@/server/auth/better-auth-readiness";

export async function GET() {
  const readiness = getBetterAuthReadiness();
  return Response.json({
    enabled: readiness.ready,
    routePath: readiness.routePath,
    providers: getPublicAuthProviders()
  });
}
