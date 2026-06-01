import { getSessionUser } from "@/server/auth/session";
import { isLeadAdmin } from "@/server/auth/roles";
import { getAgentIntegrationById } from "@/server/agents/integrations";
import { listFailedAgentEvents } from "@/server/agents/outbox";
import { tenantScopeFromUser } from "@/server/tenant-context";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ agentId: string }> }
) {
  const user = await getSessionUser();
  if (!isLeadAdmin(user)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { agentId } = await params;
  const scope = tenantScopeFromUser(user);
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
