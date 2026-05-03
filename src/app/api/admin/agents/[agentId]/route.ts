import { z } from "zod";
import { getSessionUser } from "@/server/auth/session";
import { isLeadAdmin } from "@/server/auth/roles";
import { recordAuditLog } from "@/server/audit";
import {
  getAgentIntegrationById,
  updateAgentIntegration
} from "@/server/agents/integrations";
import { DEFAULT_TENANT_ID } from "@/server/tenant/types";

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  baseUrl: z.string().url().optional(),
  sharedSecret: z.string().min(8).optional(),
  provider: z.string().optional(),
  authType: z.string().optional(),
  status: z.enum(["active", "paused"]).optional(),
  policyMode: z.enum(["draft_only", "auto_send"]).optional(),
  scopes: z.record(z.unknown()).optional(),
  capabilities: z.record(z.unknown()).optional(),
  policy: z.record(z.unknown()).optional()
});

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ agentId: string }> }
) {
  const user = await getSessionUser();
  if (!isLeadAdmin(user)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { agentId } = await params;
  const agent = await getAgentIntegrationById(agentId);
  if (!agent) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  return Response.json({ agent });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ agentId: string }> }
) {
  const user = await getSessionUser();
  if (!isLeadAdmin(user)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch (error) {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = updateSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json({ error: "Invalid payload" }, { status: 400 });
  }

  const { agentId } = await params;
  const agent = await updateAgentIntegration(agentId, parsed.data);
  if (!agent) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  await recordAuditLog({
    tenantId: user?.tenant_id ?? DEFAULT_TENANT_ID,
    actorUserId: user?.id ?? null,
    action: "agent_integration_updated",
    entityType: "agent_integration",
    entityId: agent.id,
    data: { name: agent.name, status: agent.status }
  });

  return Response.json({ status: "updated", agent });
}
