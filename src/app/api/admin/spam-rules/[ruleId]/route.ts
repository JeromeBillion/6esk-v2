import { z } from "zod";
import { getSessionUser } from "@/server/auth/session";
import { isLeadAdmin } from "@/server/auth/roles";
import { db } from "@/server/db";
import { recordAuditLog } from "@/server/audit";
import { DEFAULT_TENANT_ID } from "@/server/tenant/types";

const updateSchema = z.object({
  isActive: z.boolean().optional(),
  pattern: z.string().min(1).optional()
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ ruleId: string }> }
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

  const fields: string[] = [];
  const values: Array<string | boolean> = [];
  let index = 1;

  if (typeof parsed.data.isActive === "boolean") {
    fields.push(`is_active = $${index++}`);
    values.push(parsed.data.isActive);
  }

  if (parsed.data.pattern) {
    fields.push(`pattern = $${index++}`);
    values.push(parsed.data.pattern.toLowerCase());
  }

  if (fields.length === 0) {
    return Response.json({ error: "No changes provided" }, { status: 400 });
  }

  const { ruleId } = await params;
  values.push(ruleId);

  const result = await db.query(
    `UPDATE spam_rules
     SET ${fields.join(", ")}
     WHERE id = $${index}
     RETURNING id, rule_type, scope, pattern, is_active, created_at`,
    values
  );

  if (result.rows.length === 0) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  await recordAuditLog({
    tenantId: user?.tenant_id ?? DEFAULT_TENANT_ID,
    actorUserId: user?.id ?? null,
    action: "spam_rule_updated",
    entityType: "spam_rule",
    entityId: result.rows[0].id,
    data: { isActive: result.rows[0].is_active }
  });

  return Response.json({ rule: result.rows[0] });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ ruleId: string }> }
) {
  const user = await getSessionUser();
  if (!isLeadAdmin(user)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { ruleId } = await params;
  const result = await db.query("DELETE FROM spam_rules WHERE id = $1 RETURNING id", [ruleId]);
  if (result.rows.length === 0) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  await recordAuditLog({
    tenantId: user?.tenant_id ?? DEFAULT_TENANT_ID,
    actorUserId: user?.id ?? null,
    action: "spam_rule_deleted",
    entityType: "spam_rule",
    entityId: result.rows[0].id
  });
  return Response.json({ status: "deleted" });
}
