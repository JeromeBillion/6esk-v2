import { getSessionUser } from "@/server/auth/session";
import { isLeadAdmin } from "@/server/auth/roles";
import { getAgentIntegrationById } from "@/server/agents/integrations";
import { getAgentPolicyReplay } from "@/server/agents/policy-replay";
import { tenantScopeFromUser } from "@/server/tenant-context";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ agentId: string; runId: string }> }
) {
  const user = await getSessionUser();
  if (!isLeadAdmin(user)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const scope = tenantScopeFromUser(user);
  const { agentId, runId } = await params;
  const agent = await getAgentIntegrationById(agentId, scope);
  if (!agent) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const replay = await getAgentPolicyReplay({
    runId,
    integrationId: agent.id,
    scope
  });
  if (!replay) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  return Response.json({ replay });
}
