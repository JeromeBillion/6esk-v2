import { z } from "zod";
import { getSessionUser } from "@/server/auth/session";
import { isLeadAdmin } from "@/server/auth/roles";
import { db } from "@/server/db";

const tagSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional().nullable()
});

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await db.query(
    `SELECT id, name, description
     FROM tags
     ORDER BY name`
  );

  return Response.json({ tags: result.rows });
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

  const parsed = tagSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json({ error: "Invalid payload" }, { status: 400 });
  }

  const { name, description } = parsed.data;
  const result = await db.query(
    `INSERT INTO tags (name, description)
     VALUES ($1, $2)
     ON CONFLICT (name) DO UPDATE SET description = EXCLUDED.description
     RETURNING id, name, description`,
    [name.toLowerCase(), description ?? null]
  );

  return Response.json({ tag: result.rows[0] });
}
