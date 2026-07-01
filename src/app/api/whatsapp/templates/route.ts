import { getSessionUser } from "@/server/auth/session";
import { canManageTickets } from "@/server/auth/roles";
import { sessionTenantId } from "@/server/auth/tenant-session";
import { db } from "@/server/db";
import { checkModuleEntitlement } from "@/server/tenant/module-guard";

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!canManageTickets(user)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const tenantId = sessionTenantId(user);
  if (!tenantId) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!(await checkModuleEntitlement("whatsapp", tenantId))) {
    return Response.json(
      {
        error: "WhatsApp module is not enabled for this workspace.",
        code: "module_disabled",
        module: "whatsapp"
      },
      { status: 409 }
    );
  }

  const result = await db.query(
    `SELECT id, provider, name, language, category, status, components
     FROM whatsapp_templates
     WHERE tenant_id = $1
       AND status = 'active'
     ORDER BY name, language`,
    [tenantId]
  );

  return Response.json({ templates: result.rows });
}
