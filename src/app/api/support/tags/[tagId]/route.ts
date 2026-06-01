import { z } from "zod";
import { getSessionUser } from "@/server/auth/session";
import { isLeadAdmin } from "@/server/auth/roles";
import { db } from "@/server/db";
import { recordAuditLog } from "@/server/audit";
import { tenantScopeFromUser } from "@/server/tenant-context";

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional().nullable()
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ tagId: string }> }
) {
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

  const parsed = updateSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json({ error: "Invalid payload" }, { status: 400 });
  }

  const { tagId } = await params;
  const fields: string[] = [];
  const values: Array<string | null> = [];
  let index = 1;

  if (parsed.data.name) {
    fields.push(`name = $${index++}`);
    values.push(parsed.data.name.toLowerCase());
  }

  if (Object.prototype.hasOwnProperty.call(parsed.data, "description")) {
    fields.push(`description = $${index++}`);
    values.push(parsed.data.description ?? null);
  }

  if (fields.length === 0) {
    return Response.json({ error: "No changes provided" }, { status: 400 });
  }

  values.push(tagId);
  values.push(scope.tenantKey);

  try {
    const result = await db.query(
      `UPDATE tags
       SET ${fields.join(", ")}
       WHERE id = $${index}
         AND tenant_key = $${index + 1}
       RETURNING id, name, description`,
      values
    );
    if (result.rows.length === 0) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }
    const updated = result.rows[0];
    await recordAuditLog({
      tenantKey: scope.tenantKey,
      workspaceKey: scope.workspaceKey,
      actorUserId: user?.id ?? null,
      action: "tag_updated",
      entityType: "tag",
      entityId: updated.id,
      data: { name: updated.name }
    });
    return Response.json({ tag: updated });
  } catch (error) {
    return Response.json({ error: "Failed to update tag" }, { status: 400 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ tagId: string }> }
) {
  const user = await getSessionUser();
  if (!isLeadAdmin(user)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  const scope = tenantScopeFromUser(user);

  const { tagId } = await params;
  const result = await db.query("DELETE FROM tags WHERE id = $1 AND tenant_key = $2 RETURNING id", [
    tagId,
    scope.tenantKey
  ]);
  if (result.rows.length === 0) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  await recordAuditLog({
    tenantKey: scope.tenantKey,
    workspaceKey: scope.workspaceKey,
    actorUserId: user?.id ?? null,
    action: "tag_deleted",
    entityType: "tag",
    entityId: tagId
  });
  return Response.json({ status: "deleted" });
}
