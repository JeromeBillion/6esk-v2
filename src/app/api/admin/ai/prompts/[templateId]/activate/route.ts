import { z } from "zod";
import { activateAgentPromptTemplate } from "@/server/agents/prompt-templates";
import { recordAuditLog } from "@/server/audit";
import { isLeadAdmin } from "@/server/auth/roles";
import { getSessionUser } from "@/server/auth/session";
import { sessionTenantId } from "@/server/auth/tenant-session";

const activateSchema = z.object({
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

export async function POST(
  request: Request,
  { params }: { params: Promise<{ templateId: string }> }
) {
  const access = await requireTenantLeadAdmin();
  if (!access.ok) return access.response;

  const payload = await request.json().catch(() => ({}));
  const parsed = activateSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json({ error: "Invalid payload" }, { status: 400 });
  }

  const { templateId } = await params;
  const template = await activateAgentPromptTemplate({
    tenantId: access.tenantId,
    templateId,
    actorUserId: access.user?.id ?? null,
    reason: parsed.data.reason ?? null
  });
  if (!template) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  await recordAuditLog({
    tenantId: access.tenantId,
    actorUserId: access.user?.id ?? null,
    action: "ai_prompt_template_activated",
    entityType: "agent_prompt_template",
    entityId: template.id,
    data: {
      templateKey: template.template_key,
      templateVersion: template.template_version,
      reason: parsed.data.reason ?? null
    }
  });

  return Response.json({ status: "activated", template });
}
