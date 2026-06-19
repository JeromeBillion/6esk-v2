import { getSessionUser } from "@/server/auth/session";
import { sessionTenantId } from "@/server/auth/tenant-session";
import { db } from "@/server/db";

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = sessionTenantId(user);
  if (!tenantId) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const result = await db.query(
    `SELECT id, title, category, body, is_active
     FROM macros
     WHERE tenant_id = $1
       AND is_active = true
     ORDER BY title`,
    [tenantId]
  );

  return Response.json({ macros: result.rows });
}
