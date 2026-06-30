import { z } from "zod";
import { rollbackAgentPromptTemplate } from "@/server/agents/prompt-templates";
import { recordAuditLog } from "@/server/audit";
import { requireAiAutomationAdminAccess } from "../../access";

const rollbackSchema = z
  .object({
    templateKey: z.string().trim().min(1).max(120).optional(),
    reason: z.string().trim().max(500).optional().nullable()
  })
  .strict();

export async function POST(request: Request) {
  const access = await requireAiAutomationAdminAccess();
  if (!access.ok) return access.response;
  const { user, tenantId } = access.access;

  const payload = await request.json().catch(() => ({}));
  const parsed = rollbackSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json({ error: "Invalid payload" }, { status: 400 });
  }

  const template = await rollbackAgentPromptTemplate({
    tenantId,
    templateKey: parsed.data.templateKey,
    actorUserId: user.id,
    reason: parsed.data.reason ?? null
  });
  if (!template) {
    return Response.json({ error: "No retired template available" }, { status: 404 });
  }

  await recordAuditLog({
    tenantId,
    actorUserId: user.id,
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
