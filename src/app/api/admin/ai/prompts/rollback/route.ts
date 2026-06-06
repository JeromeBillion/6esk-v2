import { z } from "zod";
import { requireLeadAdminAccess } from "@/server/auth/admin-guard";
import { recordAuditLog } from "@/server/audit";
import { rollbackAgentPromptTemplate } from "@/server/agents/prompt-templates";

const rollbackSchema = z.object({
  templateKey: z.string().min(1).max(120).optional(),
  reason: z.string().max(500).optional().nullable()
});

export async function POST(request: Request) {
  const access = await requireLeadAdminAccess({ requireMfa: true });
  if (!access.ok) return access.response;
  const { user, scope } = access;

  let payload: unknown = {};
  try {
    payload = await request.json();
  } catch {
    payload = {};
  }

  const parsed = rollbackSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json({ error: "Invalid payload" }, { status: 400 });
  }

  const template = await rollbackAgentPromptTemplate({
    tenantKey: scope.tenantKey,
    workspaceKey: scope.workspaceKey,
    templateKey: parsed.data.templateKey,
    actorUserId: user?.id ?? null,
    reason: parsed.data.reason ?? "Rolled back from Admin"
  });
  if (!template) {
    return Response.json({ error: "No retired template available" }, { status: 404 });
  }

  await recordAuditLog({
    tenantKey: scope.tenantKey,
    workspaceKey: scope.workspaceKey,
    actorUserId: user?.id ?? null,
    action: "ai_prompt_template_rolled_back",
    entityType: "ai_prompt_template",
    entityId: template.id,
    data: {
      templateKey: template.template_key,
      templateVersion: template.template_version
    }
  });

  return Response.json({ status: "rolled_back", template });
}
