import { z } from "zod";
import { db } from "@/server/db";
import { requireLeadAdminAccess } from "@/server/auth/admin-guard";
import { recordAuditLog } from "@/server/audit";

const updateSchema = z.object({
  roleId: z.string().uuid().optional(),
  isActive: z.boolean().optional()
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  const auth = await requireLeadAdminAccess({ requireMfa: true });
  if (!auth.ok) return auth.response;
  const { user, scope } = auth;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch (error) {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = updateSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json({ error: "Invalid payload" }, { status: 400 });
  }

  const { userId } = await params;
  const existing = await db.query(
    `SELECT id, email, role_id, is_active
     FROM users
     WHERE id = $1
       AND tenant_key = $2
       AND workspace_key = $3`,
    [userId, scope.tenantKey, scope.workspaceKey]
  );
  const current = existing.rows[0];
  if (!current) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const fields: string[] = [];
  const values: Array<string | boolean> = [];
  let index = 1;

  if (parsed.data.roleId) {
    fields.push(`role_id = $${index++}`);
    values.push(parsed.data.roleId);
  }

  if (typeof parsed.data.isActive === "boolean") {
    fields.push(`is_active = $${index++}`);
    values.push(parsed.data.isActive);
  }

  if (fields.length === 0) {
    return Response.json({ status: "unchanged", user: current });
  }

  fields.push("updated_at = now()");
  const userIdParamIndex = index;
  values.push(userId, scope.tenantKey, scope.workspaceKey);

  const result = await db.query(
    `UPDATE users
     SET ${fields.join(", ")}
     WHERE id = $${userIdParamIndex}
       AND tenant_key = $${userIdParamIndex + 1}
       AND workspace_key = $${userIdParamIndex + 2}
     RETURNING id, email, display_name, role_id, is_active, created_at`,
    values
  );

  const updated = result.rows[0];
  if (!updated) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  await recordAuditLog({
    tenantKey: scope.tenantKey,
    workspaceKey: scope.workspaceKey,
    actorUserId: user?.id ?? null,
    action: "user_updated",
    entityType: "user",
    entityId: updated.id,
    data: { email: updated.email, roleId: updated.role_id, isActive: updated.is_active }
  });

  return Response.json({ status: "updated", user: updated });
}
