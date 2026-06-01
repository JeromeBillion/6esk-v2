import { z } from "zod";
import { getSessionUser } from "@/server/auth/session";
import { isLeadAdmin } from "@/server/auth/roles";
import { recordAuditLog } from "@/server/audit";
import {
  activateAgentPromptTemplate,
  createAgentPromptTemplateVersion,
  listAgentPromptTemplates
} from "@/server/agents/prompt-templates";
import { tenantScopeFromUser } from "@/server/tenant-context";

const templateBodySchema = z
  .object({
    critical_constraints: z.array(z.string().min(1).max(500)).max(50).optional()
  })
  .passthrough();

const createTemplateSchema = z.object({
  templateKey: z.string().min(1).max(120).optional(),
  templateVersion: z.string().min(1).max(160),
  templateBody: templateBodySchema,
  activate: z.boolean().optional(),
  reason: z.string().max(500).optional().nullable()
});

function parseLimit(request: Request) {
  const url = new URL(request.url);
  const raw = Number.parseInt(url.searchParams.get("limit") ?? "50", 10);
  if (Number.isNaN(raw)) return 50;
  return Math.min(Math.max(raw, 1), 200);
}

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!isLeadAdmin(user)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(request.url);
  const templates = await listAgentPromptTemplates(tenantScopeFromUser(user), {
    templateKey: url.searchParams.get("templateKey") ?? undefined,
    limit: parseLimit(request)
  });
  return Response.json({ templates });
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!isLeadAdmin(user)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

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

  const scope = tenantScopeFromUser(user);
  const created = await createAgentPromptTemplateVersion({
    tenantKey: scope.tenantKey,
    workspaceKey: scope.workspaceKey,
    templateKey: parsed.data.templateKey,
    templateVersion: parsed.data.templateVersion,
    templateBody: parsed.data.templateBody,
    metadata: {
      createdByUserId: user?.id ?? null,
      route: "/api/admin/ai/prompts",
      reason: parsed.data.reason ?? null
    }
  });

  const template = parsed.data.activate
    ? await activateAgentPromptTemplate({
        tenantKey: scope.tenantKey,
        workspaceKey: scope.workspaceKey,
        templateId: created.id,
        actorUserId: user?.id ?? null,
        reason: parsed.data.reason ?? "Created and activated from Admin"
      })
    : created;

  await recordAuditLog({
    tenantKey: scope.tenantKey,
    workspaceKey: scope.workspaceKey,
    actorUserId: user?.id ?? null,
    action: parsed.data.activate ? "ai_prompt_template_created_activated" : "ai_prompt_template_created",
    entityType: "ai_prompt_template",
    entityId: created.id,
    data: {
      templateKey: created.template_key,
      templateVersion: created.template_version,
      activated: parsed.data.activate === true
    }
  });

  return Response.json(
    {
      status: parsed.data.activate ? "created_activated" : "created",
      template
    },
    { status: 201 }
  );
}
