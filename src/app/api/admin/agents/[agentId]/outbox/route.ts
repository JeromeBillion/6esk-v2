import { requireLeadAdminAccess } from "@/server/auth/admin-guard";
import { getAgentOutboxMetrics } from "@/server/agents/outbox-metrics";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ agentId: string }> }
) {
  const access = await requireLeadAdminAccess();
  if (!access.ok) return access.response;

  const { agentId } = await params;
  const url = new URL(request.url);
  const requestedLimit = Number(url.searchParams.get("limit")) || undefined;
  const { scope } = access;
  const metrics = await getAgentOutboxMetrics(agentId, requestedLimit, scope);
  if (!metrics) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  return Response.json(metrics);
}
