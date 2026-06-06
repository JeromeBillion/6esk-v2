import { requireLeadAdminAccess } from "@/server/auth/admin-guard";
import { getAgentIntegrationById } from "@/server/agents/integrations";
import { listFailedAgentEvents } from "@/server/agents/outbox";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ agentId: string }> }
) {
  const access = await requireLeadAdminAccess();
  if (!access.ok) return access.response;

  const { agentId } = await params;
  const { scope } = access;
  const integration = await getAgentIntegrationById(agentId, scope);
  if (!integration) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const url = new URL(request.url);
  const limitParam = url.searchParams.get("limit");
  const limit = Math.min(Math.max(Number(limitParam ?? 50) || 50, 1), 200);

  const events = await listFailedAgentEvents(agentId, limit, scope);
  return Response.json({ events });
}
