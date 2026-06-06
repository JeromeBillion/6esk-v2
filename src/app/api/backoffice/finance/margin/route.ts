import { getSessionUser } from "@/server/auth/session";
import { isInternalStaff } from "@/server/auth/roles";
import { getTenantMarginSnapshot } from "@/server/billing/margin";

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!isInternalStaff(user)) {
    return Response.json({ error: "Forbidden. 6esk Staff only." }, { status: 403 });
  }
  if (!user?.tenant_id) {
    return Response.json({ error: "Tenant context missing" }, { status: 400 });
  }

  const url = new URL(request.url);
  const windowDaysRaw = Number(url.searchParams.get("windowDays"));
  const windowDays = Number.isFinite(windowDaysRaw) ? windowDaysRaw : undefined;

  const snapshot = await getTenantMarginSnapshot({
    tenantId: user.tenant_id,
    windowDays
  });
  return Response.json(snapshot);
}
