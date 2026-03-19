import { z } from "zod";
import { getSessionUser } from "@/server/auth/session";
import { db } from "@/server/db";

const filtersSchema = z
  .object({
    status: z.enum(["all", "open", "pending", "resolved", "closed"]).optional(),
    priority: z.enum(["all", "low", "medium", "high", "urgent"]).optional(),
    channel: z.enum(["all", "email", "whatsapp", "voice"]).optional(),
    tag: z.string().max(80).optional(),
    assigned: z.enum(["mine", "any"]).optional(),
    query: z.string().max(200).optional()
  })
  .strict();

const patchSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    filters: filtersSchema.optional()
  })
  .refine(
    (data) =>
      Object.prototype.hasOwnProperty.call(data, "name") ||
      Object.prototype.hasOwnProperty.call(data, "filters"),
    { message: "No updates provided." }
  );

type SavedViewRow = {
  id: string;
  name: string;
  filters: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ viewId: string }> }
) {
  const user = await getSessionUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = patchSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json({ error: "Invalid payload" }, { status: 400 });
  }

  const { viewId } = await params;
  const updates: string[] = [];
  const values: Array<string> = [];
  let index = 1;

  if (Object.prototype.hasOwnProperty.call(parsed.data, "name")) {
    updates.push(`name = $${index++}`);
    values.push(parsed.data.name ?? "");
  }
  if (Object.prototype.hasOwnProperty.call(parsed.data, "filters")) {
    updates.push(`filters = $${index++}::jsonb`);
    values.push(JSON.stringify(parsed.data.filters ?? {}));
  }
  updates.push("updated_at = now()");

  values.push(viewId, user.id);

  try {
    const result = await db.query<SavedViewRow>(
      `UPDATE support_saved_views
       SET ${updates.join(", ")}
       WHERE id = $${index++}
         AND user_id = $${index}
       RETURNING id, name, filters, created_at, updated_at`,
      values
    );
    const row = result.rows[0];
    if (!row) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }
    return Response.json({
      view: {
        id: row.id,
        name: row.name,
        filters: row.filters ?? {},
        createdAt: row.created_at,
        updatedAt: row.updated_at
      }
    });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "23505") {
      return Response.json({ error: "Saved view name already exists." }, { status: 409 });
    }
    const message = error instanceof Error ? error.message : "Failed to update saved view";
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ viewId: string }> }
) {
  const user = await getSessionUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { viewId } = await params;
  const result = await db.query(
    `DELETE FROM support_saved_views
     WHERE id = $1
       AND user_id = $2`,
    [viewId, user.id]
  );

  if ((result.rowCount ?? 0) === 0) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  return Response.json({ status: "deleted" });
}
