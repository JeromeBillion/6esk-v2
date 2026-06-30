import { z } from "zod";
import { activateAgentPromptTemplate } from "@/server/agents/prompt-templates";
import { recordAuditLog } from "@/server/audit";
import { requireAiAutomationAdminAccess } from "../../../access";

const activateSchema = z
  .object({
    reason: z.string().trim().max(500).optional().nullable()
  })
  .strict();

export async function POST(
  request: Request,
  { params }: { params: Promise<{ templateId: string }> }
) {
  const access = await requireAiAutomationAdminAccess();
  if (!access.ok) return access.response;
  const { user, tenantId } = access.access;

  const payload = await request.json().catch(() => ({}));
  const parsed = activateSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json({ error: "Invalid payload" }, { status: 400 });
  }

  const { templateId } = await params;
  const template = await activateAgentPromptTemplate({
    tenantId,
    templateId,
    actorUserId: user.id,
    reason: parsed.data.reason ?? null
  });
  if (!template) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  await recordAuditLog({
    tenantId,
    actorUserId: user.id,
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
