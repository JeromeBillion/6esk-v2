import { getSessionUser } from "@/server/auth/session";
import { isLeadAdmin } from "@/server/auth/roles";
import { getAgentOutboxMetrics } from "@/server/agents/outbox-metrics";
import { DEFAULT_TENANT_ID } from "@/server/tenant/types";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ agentId: string }> }
) {
  const user = await getSessionUser();
  if (!isLeadAdmin(user)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { agentId } = await params;
  const tenantId = user?.tenant_id ?? DEFAULT_TENANT_ID;
  const url = new URL(request.url);
  const requestedLimit = Number(url.searchParams.get("limit")) || undefined;
  const metrics = await getAgentOutboxMetrics(agentId, requestedLimit, tenantId);
  if (!metrics) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  return Response.json(metrics);
}
