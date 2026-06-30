import { getBackofficeOverview } from "@/server/backoffice/overview";
import { requireBackofficeStaff } from "@/server/backoffice/authz";

export async function GET(request: Request) {
  const auth = await requireBackofficeStaff(request.headers);
  if (!auth.ok) return auth.response;
  if (!auth.user.tenant_id) {
    return Response.json({ error: "Tenant context missing" }, { status: 400 });
  }

  const overview = await getBackofficeOverview({ tenantId: auth.user.tenant_id });
  return Response.json(overview);
}
