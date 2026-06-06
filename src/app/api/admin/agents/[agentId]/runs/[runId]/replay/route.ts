import { requireLeadAdminAccess } from "@/server/auth/admin-guard";
import { getAgentIntegrationById } from "@/server/agents/integrations";
import { getAgentPolicyReplay } from "@/server/agents/policy-replay";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ agentId: string; runId: string }> }
) {
  const access = await requireLeadAdminAccess();
  if (!access.ok) return access.response;

  const { scope } = access;
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
