import { getSessionUser } from "@/server/auth/session";
import { db } from "@/server/db";

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
