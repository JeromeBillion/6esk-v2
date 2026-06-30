import { z } from "zod";
import {
  activateAgentPromptTemplate,
  createAgentPromptTemplateVersion,
  listAgentPromptTemplates
} from "@/server/agents/prompt-templates";
import { recordAuditLog } from "@/server/audit";
import { requireAiAutomationAdminAccess } from "../access";

const templateBodySchema = z
  .object({
    criticalConstraints: z.array(z.string().min(1).max(500)).max(50).optional(),
    critical_constraints: z.array(z.string().min(1).max(500)).max(50).optional()
  })
  .passthrough();

const createTemplateSchema = z
  .object({
    templateKey: z.string().trim().min(1).max(120).optional(),
    templateVersion: z.string().trim().min(1).max(160),
    templateBody: templateBodySchema,
    activate: z.boolean().optional(),
    reason: z.string().trim().max(500).optional().nullable()
  })
  .strict();

function readLimit(request: Request) {
  const url = new URL(request.url);
  const parsed = Number.parseInt(url.searchParams.get("limit") ?? "50", 10);
  if (!Number.isFinite(parsed)) return 50;
  return Math.min(Math.max(parsed, 1), 200);
}

export async function GET(request: Request) {
  const access = await requireAiAutomationAdminAccess();
  if (!access.ok) return access.response;
  const { tenantId } = access.access;

  const url = new URL(request.url);
  const templates = await listAgentPromptTemplates({
    tenantId
  }, {
    templateKey: url.searchParams.get("templateKey") ?? undefined,
    limit: readLimit(request)
  });

  return Response.json({ templates });
}

export async function POST(request: Request) {
  const access = await requireAiAutomationAdminAccess();
  if (!access.ok) return access.response;
  const { user, tenantId } = access.access;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = createTemplateSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json({ error: "Invalid payload" }, { status: 400 });
  }

  const created = await createAgentPromptTemplateVersion({
    tenantId,
    templateKey: parsed.data.templateKey,
    templateVersion: parsed.data.templateVersion,
    templateBody: parsed.data.templateBody,
    actorUserId: user.id,
    reason: parsed.data.reason ?? null,
    metadata: {
      route: "/api/admin/ai/prompts",
      createdByUserId: user.id,
      reason: parsed.data.reason ?? null
    }
  });

  const template = parsed.data.activate
    ? await activateAgentPromptTemplate({
        tenantId,
        templateId: created.id,
        actorUserId: user.id,
        reason: parsed.data.reason ?? "Created and activated from Admin"
      })
    : created;

  await recordAuditLog({
    tenantId,
    actorUserId: user.id,
    action: parsed.data.activate ? "ai_prompt_template_created_activated" : "ai_prompt_template_created",
    entityType: "agent_prompt_template",
    entityId: created.id,
    data: {
      templateKey: created.template_key,
      templateVersion: created.template_version,
      activated: parsed.data.activate === true
    }
  });

  return Response.json({
    status: parsed.data.activate ? "created_activated" : "created",
    template
  }, { status: 201 });
}
