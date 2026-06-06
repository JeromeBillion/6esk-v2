import { requireLeadAdminAccess } from "@/server/auth/admin-guard";
import { getAgentIntegrationById } from "@/server/agents/integrations";
import { listRecentAgentRuns } from "@/server/agents/run-ledger";

function parseLimit(request: Request) {
  const url = new URL(request.url);
  const raw = Number.parseInt(url.searchParams.get("limit") ?? "50", 10);
  if (Number.isNaN(raw)) return 50;
  return Math.min(Math.max(raw, 1), 200);
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ agentId: string }> }
) {
  const access = await requireLeadAdminAccess();
  if (!access.ok) return access.response;

  const { agentId } = await params;
  const { scope } = access;
  const agent = await getAgentIntegrationById(agentId, scope);
  if (!agent) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const runs = await listRecentAgentRuns({
    integrationId: agent.id,
    tenantKey: scope.tenantKey,
    workspaceKey: scope.workspaceKey,
    limit: parseLimit(request)
  });

  return Response.json({ runs });
}
