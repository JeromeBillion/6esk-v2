import { getSessionUser } from "@/server/auth/session";
import { isInternalStaff } from "@/server/auth/roles";
import { getBackofficeOverview } from "@/server/backoffice/overview";

export async function GET() {
  const user = await getSessionUser();
  if (!isInternalStaff(user)) {
    return Response.json({ error: "Forbidden. 6esk Staff only." }, { status: 403 });
  }
  if (!user?.tenant_id) {
    return Response.json({ error: "Tenant context missing" }, { status: 400 });
  }

  const overview = await getBackofficeOverview({ tenantId: user.tenant_id });
  return Response.json(overview);
}
