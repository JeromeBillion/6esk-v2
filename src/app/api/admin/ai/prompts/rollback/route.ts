import { z } from "zod";
import { rollbackAgentPromptTemplate } from "@/server/agents/prompt-templates";
import { recordAuditLog } from "@/server/audit";
import { isLeadAdmin } from "@/server/auth/roles";
import { getSessionUser } from "@/server/auth/session";
import { sessionTenantId } from "@/server/auth/tenant-session";

const rollbackSchema = z.object({
  templateKey: z.string().trim().min(1).max(120).optional(),
  reason: z.string().trim().max(500).optional().nullable()
});

async function requireTenantLeadAdmin() {
  const user = await getSessionUser();
  if (!isLeadAdmin(user)) {
    return { ok: false as const, response: Response.json({ error: "Forbidden" }, { status: 403 }) };
  }
  const tenantId = sessionTenantId(user);
  if (!tenantId) {
    return { ok: false as const, response: Response.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { ok: true as const, user, tenantId };
}

export async function POST(request: Request) {
  const access = await requireTenantLeadAdmin();
  if (!access.ok) return access.response;

  const payload = await request.json().catch(() => ({}));
  const parsed = rollbackSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json({ error: "Invalid payload" }, { status: 400 });
  }

  const template = await rollbackAgentPromptTemplate({
    tenantId: access.tenantId,
    templateKey: parsed.data.templateKey,
    actorUserId: access.user?.id ?? null,
    reason: parsed.data.reason ?? null
  });
  if (!template) {
    return Response.json({ error: "No retired template available" }, { status: 404 });
  }

  await recordAuditLog({
    tenantId: access.tenantId,
    actorUserId: access.user?.id ?? null,
    action: "ai_prompt_template_rolled_back",
    entityType: "agent_prompt_template",
    entityId: template.id,
    data: {
      templateKey: template.template_key,
      templateVersion: template.template_version,
      reason: parsed.data.reason ?? null
    }
  });

  return Response.json({ status: "rolled_back", template });
}
