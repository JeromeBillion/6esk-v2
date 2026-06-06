import { requireLeadAdminOrMachineAccess } from "@/server/auth/admin-guard";
import { getInboundMetrics } from "@/server/email/inbound-metrics";

export async function GET(request: Request) {
  const access = await requireLeadAdminOrMachineAccess(request, {
    requireMfaForUser: false,
    secretEnvNames: ["INBOUND_SHARED_SECRET"]
  });
  if (!access.ok) return access.response;
  const { scope } = access;

  const url = new URL(request.url);
  const requestedHours = Number(url.searchParams.get("hours") ?? 24) || 24;
  const metrics = await getInboundMetrics(requestedHours, scope);
  return Response.json(metrics);
}
