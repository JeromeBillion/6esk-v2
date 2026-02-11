import { z } from "zod";
import { getSessionUser } from "@/server/auth/session";
import { isLeadAdmin } from "@/server/auth/roles";
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
  const user = await getSessionUser();
  if (!isLeadAdmin(user)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const result = await db.query(
    `SELECT id, provider, name, language, category, status, components, created_at, updated_at
     FROM whatsapp_templates
     ORDER BY name, language`
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

  const result = await db.query(
    `INSERT INTO whatsapp_templates (provider, name, language, category, status, components)
     VALUES ($1, $2, $3, $4, $5, $6)
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
      data.components ?? null
    ]
  );

  const saved = result.rows[0];
  await recordAuditLog({
    actorUserId: user?.id ?? null,
    action: "whatsapp_template_saved",
    entityType: "whatsapp_template",
    entityId: saved.id,
    data: { name: saved.name, language: saved.language }
  });

  return Response.json({ template: saved });
}
