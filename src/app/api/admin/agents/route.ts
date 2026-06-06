import { z } from "zod";
import { requireLeadAdminAccess } from "@/server/auth/admin-guard";
import { recordAuditLog } from "@/server/audit";
import {
  createAgentIntegration,
  listAgentIntegrations
} from "@/server/agents/integrations";
import { AGENT_POLICY_MODE_VALUES } from "@/server/agents/policy-modes";

const createSchema = z.object({
  tenantKey: z.string().min(1).optional(),
  name: z.string().min(1),
  baseUrl: z.string().url(),
  sharedSecret: z.string().min(8),
  provider: z.string().optional(),
  authType: z.string().optional(),
  status: z.enum(["active", "paused"]).optional(),
  policyMode: z.enum(AGENT_POLICY_MODE_VALUES).optional(),
  scopes: z.record(z.unknown()).optional(),
  capabilities: z.record(z.unknown()).optional(),
  policy: z.record(z.unknown()).optional()
});

export async function GET() {
  const access = await requireLeadAdminAccess();
  if (!access.ok) return access.response;

  const { scope } = access;
  const agents = await listAgentIntegrations(scope);
  return Response.json({ agents });
}

export async function POST(request: Request) {
  const access = await requireLeadAdminAccess({ requireMfa: true });
  if (!access.ok) return access.response;
  const { user, scope } = access;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch (error) {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = createSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json({ error: "Invalid payload" }, { status: 400 });
  }

  const agent = await createAgentIntegration({
    ...parsed.data,
    tenantKey: scope.tenantKey
  });
  await recordAuditLog({
    tenantKey: scope.tenantKey,
    workspaceKey: scope.workspaceKey,
    actorUserId: user?.id ?? null,
    action: "agent_integration_created",
    entityType: "agent_integration",
    entityId: agent.id,
    data: { name: agent.name, baseUrl: agent.base_url, status: agent.status }
  });
  return Response.json({ status: "created", agent });
}
