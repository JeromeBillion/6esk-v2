import { getSessionUser } from "@/server/auth/session";
import { getInboundMetrics } from "@/server/email/inbound-metrics";
import { resolveInboundAdminScope } from "@/server/email/inbound-admin-scope";

export async function GET(request: Request) {
  const user = await getSessionUser();
  const scope = await resolveInboundAdminScope(request, user);
  if (!scope.ok) {
    return scope.response;
  }

  const url = new URL(request.url);
  const requestedHours = Number(url.searchParams.get("hours") ?? 24) || 24;
  const metrics = await getInboundMetrics(scope.tenantId, requestedHours);
  return Response.json(metrics);
}
