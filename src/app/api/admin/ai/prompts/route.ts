import { z } from "zod";
import {
  activateAgentPromptTemplate,
  createAgentPromptTemplateVersion,
  listAgentPromptTemplates
} from "@/server/agents/prompt-templates";
import { recordAuditLog } from "@/server/audit";
import { isLeadAdmin } from "@/server/auth/roles";
import { getSessionUser } from "@/server/auth/session";
import { sessionTenantId } from "@/server/auth/tenant-session";

const templateBodySchema = z
  .object({
    criticalConstraints: z.array(z.string().min(1).max(500)).max(50).optional(),
    critical_constraints: z.array(z.string().min(1).max(500)).max(50).optional()
  })
  .passthrough();

const createTemplateSchema = z.object({
  templateKey: z.string().trim().min(1).max(120).optional(),
  templateVersion: z.string().trim().min(1).max(160),
  templateBody: templateBodySchema,
  activate: z.boolean().optional(),
  reason: z.string().trim().max(500).optional().nullable()
});

function readLimit(request: Request) {
  const url = new URL(request.url);
  const parsed = Number.parseInt(url.searchParams.get("limit") ?? "50", 10);
  if (!Number.isFinite(parsed)) return 50;
  return Math.min(Math.max(parsed, 1), 200);
}

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

export async function GET(request: Request) {
  const access = await requireTenantLeadAdmin();
  if (!access.ok) return access.response;

  const url = new URL(request.url);
  const templates = await listAgentPromptTemplates({
    tenantId: access.tenantId
  }, {
    templateKey: url.searchParams.get("templateKey") ?? undefined,
    limit: readLimit(request)
  });

  return Response.json({ templates });
}

export async function POST(request: Request) {
  const access = await requireTenantLeadAdmin();
  if (!access.ok) return access.response;

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
    tenantId: access.tenantId,
    templateKey: parsed.data.templateKey,
    templateVersion: parsed.data.templateVersion,
    templateBody: parsed.data.templateBody,
    actorUserId: access.user?.id ?? null,
    reason: parsed.data.reason ?? null,
    metadata: {
      route: "/api/admin/ai/prompts",
      createdByUserId: access.user?.id ?? null,
      reason: parsed.data.reason ?? null
    }
  });

  const template = parsed.data.activate
    ? await activateAgentPromptTemplate({
        tenantId: access.tenantId,
        templateId: created.id,
        actorUserId: access.user?.id ?? null,
        reason: parsed.data.reason ?? "Created and activated from Admin"
      })
    : created;

  await recordAuditLog({
    tenantId: access.tenantId,
    actorUserId: access.user?.id ?? null,
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
