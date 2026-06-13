import { getAgentIntegrationById } from "@/server/agents/integrations";
import { getAgentRunReplay } from "@/server/agents/run-replay";
import { isLeadAdmin } from "@/server/auth/roles";
import { getSessionUser } from "@/server/auth/session";
import { sessionTenantId } from "@/server/auth/tenant-session";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ agentId: string; runId: string }> }
) {
  const user = await getSessionUser();
  if (!isLeadAdmin(user)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  const tenantId = sessionTenantId(user);
  if (!tenantId) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { agentId, runId } = await params;
  const integration = await getAgentIntegrationById(agentId, tenantId);
  if (!integration) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const replay = await getAgentRunReplay({
    tenantId,
    integrationId: integration.id,
    runId
  });
  if (!replay) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  return Response.json({ replay });
}
