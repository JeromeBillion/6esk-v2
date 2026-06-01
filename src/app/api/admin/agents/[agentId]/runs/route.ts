import { getSessionUser } from "@/server/auth/session";
import { isLeadAdmin } from "@/server/auth/roles";
import { getAgentIntegrationById } from "@/server/agents/integrations";
import { listRecentAgentRuns } from "@/server/agents/run-ledger";
import { tenantScopeFromUser } from "@/server/tenant-context";

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
  const user = await getSessionUser();
  if (!isLeadAdmin(user)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { agentId } = await params;
  const scope = tenantScopeFromUser(user);
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
