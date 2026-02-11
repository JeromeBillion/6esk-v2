import { z } from "zod";
import { getSessionUser } from "@/server/auth/session";
import { isLeadAdmin } from "@/server/auth/roles";
import { db } from "@/server/db";
import { recordAuditLog } from "@/server/audit";

const updateSchema = z.object({
  provider: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  language: z.string().min(1).optional(),
  category: z.string().optional().nullable(),
  status: z.enum(["active", "paused"]).optional(),
  components: z.array(z.record(z.unknown())).optional().nullable()
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ templateId: string }> }
) {
  const user = await getSessionUser();
  if (!isLeadAdmin(user)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { templateId } = await params;
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

  const data = parsed.data;
  const fields: string[] = [];
  const values: Array<unknown> = [];
  let index = 1;

  if (data.provider) {
    fields.push(`provider = $${index++}`);
    values.push(data.provider);
  }
  if (data.name) {
    fields.push(`name = $${index++}`);
    values.push(data.name);
  }
  if (data.language) {
    fields.push(`language = $${index++}`);
    values.push(data.language);
  }
  if (Object.prototype.hasOwnProperty.call(data, "category")) {
    fields.push(`category = $${index++}`);
    values.push(data.category ?? null);
  }
  if (data.status) {
    fields.push(`status = $${index++}`);
    values.push(data.status);
  }
  if (Object.prototype.hasOwnProperty.call(data, "components")) {
    fields.push(`components = $${index++}`);
    values.push(data.components ?? null);
  }

  if (fields.length === 0) {
    return Response.json({ error: "No updates provided" }, { status: 400 });
  }

  fields.push("updated_at = now()");
  values.push(templateId);

  const result = await db.query(
    `UPDATE whatsapp_templates
     SET ${fields.join(", ")}
     WHERE id = $${index}
     RETURNING id, provider, name, language, category, status, components`,
    values
  );

  const updated = result.rows[0];
  if (!updated) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  await recordAuditLog({
    actorUserId: user?.id ?? null,
    action: "whatsapp_template_updated",
    entityType: "whatsapp_template",
    entityId: templateId,
    data: { name: updated.name, language: updated.language }
  });

  return Response.json({ template: updated });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ templateId: string }> }
) {
  const user = await getSessionUser();
  if (!isLeadAdmin(user)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { templateId } = await params;
  const result = await db.query(
    `DELETE FROM whatsapp_templates
     WHERE id = $1
     RETURNING id, name, language`,
    [templateId]
  );

  const deleted = result.rows[0];
  if (!deleted) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  await recordAuditLog({
    actorUserId: user?.id ?? null,
    action: "whatsapp_template_deleted",
    entityType: "whatsapp_template",
    entityId: templateId,
    data: { name: deleted.name, language: deleted.language }
  });

  return Response.json({ status: "ok" });
}
