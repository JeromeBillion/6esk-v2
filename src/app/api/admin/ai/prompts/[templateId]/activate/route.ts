import { z } from "zod";
import { requireLeadAdminAccess } from "@/server/auth/admin-guard";
import { recordAuditLog } from "@/server/audit";
import { activateAgentPromptTemplate } from "@/server/agents/prompt-templates";

const activateSchema = z.object({
  reason: z.string().max(500).optional().nullable()
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ templateId: string }> }
) {
  const access = await requireLeadAdminAccess({ requireMfa: true });
  if (!access.ok) return access.response;
  const { user, scope } = access;

  let payload: unknown = {};
  try {
    payload = await request.json();
  } catch {
    payload = {};
  }

  const parsed = activateSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json({ error: "Invalid payload" }, { status: 400 });
  }

  const { templateId } = await params;
  const template = await activateAgentPromptTemplate({
    tenantKey: scope.tenantKey,
    workspaceKey: scope.workspaceKey,
    templateId,
    actorUserId: user?.id ?? null,
    reason: parsed.data.reason ?? "Activated from Admin"
  });
  if (!template) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  await recordAuditLog({
    tenantKey: scope.tenantKey,
    workspaceKey: scope.workspaceKey,
    actorUserId: user?.id ?? null,
    action: "ai_prompt_template_activated",
    entityType: "ai_prompt_template",
    entityId: template.id,
    data: {
      templateKey: template.template_key,
      templateVersion: template.template_version
    }
  });

  return Response.json({ status: "activated", template });
}
