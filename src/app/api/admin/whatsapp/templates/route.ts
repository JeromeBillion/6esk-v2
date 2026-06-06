import { z } from "zod";
import { requireLeadAdminAccess } from "@/server/auth/admin-guard";
import { db } from "@/server/db";
import { recordAuditLog } from "@/server/audit";

const templateSchema = z.object({
  provider: z.string().min(1).default("meta"),
  name: z.string().min(1),
  language: z.string().min(1).default("en_US"),
  category: z.string().optional().nullable(),
  status: z.enum(["active", "paused"]).optional(),
  components: z.array(z.record(z.unknown())).optional().nullable()
});

export async function GET() {
  const access = await requireLeadAdminAccess();
  if (!access.ok) return access.response;
  const { scope } = access;

  const result = await db.query(
    `SELECT id, provider, name, language, category, status, components, created_at, updated_at
     FROM whatsapp_templates
     WHERE tenant_key = $1
       AND workspace_key = $2
     ORDER BY name, language`,
    [scope.tenantKey, scope.workspaceKey]
  );

  return Response.json({ templates: result.rows });
}

export async function POST(request: Request) {
  const access = await requireLeadAdminAccess({ requireMfa: true });
  if (!access.ok) return access.response;
  const { user, scope } = access;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch (error) {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = templateSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json({ error: "Invalid payload" }, { status: 400 });
  }

  const data = parsed.data;
  const status = data.status ?? "active";

  const result = await db.query(
    `INSERT INTO whatsapp_templates (tenant_key, workspace_key, provider, name, language, category, status, components)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (tenant_key, workspace_key, provider, name, language)
     DO UPDATE SET
       category = EXCLUDED.category,
       status = EXCLUDED.status,
       components = EXCLUDED.components,
       updated_at = now()
     RETURNING id, provider, name, language, category, status, components`,
    [
      scope.tenantKey,
      scope.workspaceKey,
      data.provider,
      data.name,
      data.language,
      data.category ?? null,
      status,
      data.components ?? null
    ]
  );

  const saved = result.rows[0];
  await recordAuditLog({
    tenantKey: scope.tenantKey,
    workspaceKey: scope.workspaceKey,
    actorUserId: user?.id ?? null,
    action: "whatsapp_template_saved",
    entityType: "whatsapp_template",
    entityId: saved.id,
    data: { name: saved.name, language: saved.language }
  });

  return Response.json({ template: saved });
}
