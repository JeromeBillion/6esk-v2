import { z } from "zod";
import { getSessionUser } from "@/server/auth/session";
import { isLeadAdmin } from "@/server/auth/roles";
import { db } from "@/server/db";
import { recordAuditLog } from "@/server/audit";
import { tenantScopeFromUser } from "@/server/tenant-context";

const tagSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional().nullable()
});

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const scope = tenantScopeFromUser(user);

  const result = await db.query(
    `SELECT id, name, description
     FROM tags
     WHERE tenant_key = $1
     ORDER BY name`,
    [scope.tenantKey]
  );

  return Response.json({ tags: result.rows });
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!isLeadAdmin(user)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  const scope = tenantScopeFromUser(user);

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
  const existing = await db.query(
    "SELECT id FROM tags WHERE tenant_key = $1 AND name = $2 LIMIT 1",
    [scope.tenantKey, name.toLowerCase()]
  );
  const existed = existing.rowCount && existing.rowCount > 0;

  const result = await db.query(
    `INSERT INTO tags (tenant_key, workspace_key, name, description)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (tenant_key, name) DO UPDATE SET description = EXCLUDED.description
     RETURNING id, name, description`,
    [scope.tenantKey, scope.workspaceKey, name.toLowerCase(), description ?? null]
  );

  const created = result.rows[0];
  await recordAuditLog({
    tenantKey: scope.tenantKey,
    workspaceKey: scope.workspaceKey,
    actorUserId: user?.id ?? null,
    action: existed ? "tag_updated" : "tag_created",
    entityType: "tag",
    entityId: created.id,
    data: { name: created.name }
  });

  return Response.json({ tag: created });
}
