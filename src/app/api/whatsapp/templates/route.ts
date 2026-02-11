import { getSessionUser } from "@/server/auth/session";
import { db } from "@/server/db";

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await db.query(
    `SELECT id, provider, name, language, category, status, components
     FROM whatsapp_templates
     WHERE status = 'active'
     ORDER BY name, language`
  );

  return Response.json({ templates: result.rows });
}
