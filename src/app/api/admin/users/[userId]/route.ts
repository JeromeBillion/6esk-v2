import { z } from "zod";
import { db } from "@/server/db";
import { getSessionUser } from "@/server/auth/session";
import { isLeadAdmin } from "@/server/auth/roles";
import { recordAuditLog } from "@/server/audit";

const updateSchema = z.object({
  roleId: z.string().uuid().optional(),
  isActive: z.boolean().optional()
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
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

  const parsed = updateSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json({ error: "Invalid payload" }, { status: 400 });
  }

  const { userId } = await params;
  const existing = await db.query(
    "SELECT id, email, role_id, is_active FROM users WHERE id = $1",
    [userId]
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
  values.push(userId);

  const result = await db.query(
    `UPDATE users
     SET ${fields.join(", ")}
     WHERE id = $${index}
     RETURNING id, email, display_name, role_id, is_active, created_at`,
    values
  );

  const updated = result.rows[0];

  await recordAuditLog({
    actorUserId: user?.id ?? null,
    action: "user_updated",
    entityType: "user",
    entityId: updated.id,
    data: { email: updated.email, roleId: updated.role_id, isActive: updated.is_active }
  });

  return Response.json({ status: "updated", user: updated });
}
