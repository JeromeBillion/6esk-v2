import { getSessionUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { tenantScopeFromUser } from "@/server/tenant-context";

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const scope = tenantScopeFromUser(user);

  const result = await db.query(
    `SELECT id, title, category, body, is_active
     FROM macros
     WHERE tenant_key = $1
       AND is_active = true
     ORDER BY title`,
    [scope.tenantKey]
  );

  return Response.json({ macros: result.rows });
}
