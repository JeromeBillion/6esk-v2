import { z } from "zod";
import { getSessionUser } from "@/server/auth/session";
import { isLeadAdmin } from "@/server/auth/roles";
import { sessionTenantId } from "@/server/auth/tenant-session";
import { db } from "@/server/db";
import { recordAuditLog } from "@/server/audit";

const tagSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional().nullable()
});

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = sessionTenantId(user);
  if (!tenantId) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const result = await db.query(
    `SELECT id, name, description
     FROM tags
     WHERE tenant_id = $1
     ORDER BY name`,
    [tenantId]
  );

  return Response.json({ tags: result.rows });
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!isLeadAdmin(user)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  const tenantId = sessionTenantId(user);
  if (!tenantId) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch (error) {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = tagSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json({ error: "Invalid payload" }, { status: 400 });
  }

  const { name, description } = parsed.data;
  const normalizedName = name.toLowerCase();
  const existing = await db.query("SELECT id FROM tags WHERE tenant_id = $1 AND name = $2 LIMIT 1", [
    tenantId,
    normalizedName
  ]);
  const existed = existing.rowCount && existing.rowCount > 0;

  const result = await db.query(
    `INSERT INTO tags (tenant_id, name, description)
     VALUES ($1, $2, $3)
     ON CONFLICT (tenant_id, name) DO UPDATE SET description = EXCLUDED.description
     RETURNING id, name, description`,
    [tenantId, normalizedName, description ?? null]
  );

  const created = result.rows[0];
  await recordAuditLog({
    tenantId,
    actorUserId: user?.id ?? null,
    action: existed ? "tag_updated" : "tag_created",
    entityType: "tag",
    entityId: created.id,
    data: { name: created.name }
  });

  return Response.json({ tag: created });
}
