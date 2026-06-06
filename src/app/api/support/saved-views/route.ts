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

const createSchema = z.object({
  name: z.string().trim().min(1).max(80),
  filters: filtersSchema
});

type SavedViewRow = {
  id: string;
  name: string;
  filters: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await db.query<SavedViewRow>(
    `SELECT id, name, filters, created_at, updated_at
     FROM support_saved_views
     WHERE user_id = $1
     ORDER BY updated_at DESC, created_at DESC`,
    [user.id]
  );

  return Response.json({
    views: result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      filters: row.filters ?? {},
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }))
  });
}

export async function POST(request: Request) {
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

  const parsed = createSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json({ error: "Invalid payload" }, { status: 400 });
  }

  try {
    const result = await db.query<SavedViewRow>(
      `INSERT INTO support_saved_views (user_id, name, filters)
       VALUES ($1, $2, $3::jsonb)
       RETURNING id, name, filters, created_at, updated_at`,
      [user.id, parsed.data.name, JSON.stringify(parsed.data.filters)]
    );
    const row = result.rows[0];
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
    const message = error instanceof Error ? error.message : "Failed to create saved view";
    return Response.json({ error: message }, { status: 500 });
  }
}
