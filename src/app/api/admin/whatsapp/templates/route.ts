import { z } from "zod";
import { getSessionUser } from "@/server/auth/session";
import { isLeadAdmin } from "@/server/auth/roles";
import { db } from "@/server/db";
import { recordAuditLog } from "@/server/audit";
import { DEFAULT_TENANT_ID } from "@/server/tenant/types";

const templateSchema = z.object({
  provider: z.string().min(1).default("meta"),
  name: z.string().min(1),
  language: z.string().min(1).default("en_US"),
  category: z.string().optional().nullable(),
  status: z.enum(["active", "paused"]).optional(),
  components: z.array(z.record(z.unknown())).optional().nullable()
});

export async function GET() {
  const user = await getSessionUser();
  if (!isLeadAdmin(user)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const tenantId = user?.tenant_id ?? DEFAULT_TENANT_ID;
  const result = await db.query(
    `SELECT id, provider, name, language, category, status, components, created_at, updated_at
     FROM whatsapp_templates
     WHERE tenant_id = $1
     ORDER BY name, language`,
    [tenantId]
  );

  return Response.json({ templates: result.rows });
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!isLeadAdmin(user)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

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

  const tenantId = user?.tenant_id ?? DEFAULT_TENANT_ID;
  const result = await db.query(
    `INSERT INTO whatsapp_templates (provider, name, language, category, status, components, tenant_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (provider, name, language)
     DO UPDATE SET
       category = EXCLUDED.category,
       status = EXCLUDED.status,
       components = EXCLUDED.components,
       updated_at = now()
     RETURNING id, provider, name, language, category, status, components`,
    [
      data.provider,
      data.name,
      data.language,
      data.category ?? null,
      status,
      data.components ?? null,
      tenantId
    ]
  );

  const saved = result.rows[0];
  await recordAuditLog({
    tenantId,
    actorUserId: user?.id ?? null,
    action: "whatsapp_template_saved",
    entityType: "whatsapp_template",
    entityId: saved.id,
    data: { name: saved.name, language: saved.language }
  });

  return Response.json({ template: saved });
}
