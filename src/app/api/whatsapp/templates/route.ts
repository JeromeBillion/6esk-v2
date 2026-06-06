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
    `SELECT id, provider, name, language, category, status, components
     FROM whatsapp_templates
     WHERE tenant_key = $1
       AND workspace_key = $2
       AND status = 'active'
     ORDER BY name, language`,
    [scope.tenantKey, scope.workspaceKey]
  );

  return Response.json({ templates: result.rows });
}
