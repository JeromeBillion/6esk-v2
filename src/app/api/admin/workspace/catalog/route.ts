import { getSessionUser } from "@/server/auth/session";
import { isTenantAdmin } from "@/server/auth/roles";
import { PLAN_CATALOG } from "@/server/tenant/catalog";

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!isTenantAdmin(user)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  // Convert the catalog map to an array for the frontend
  const plans = Object.values(PLAN_CATALOG);

  return Response.json({ plans });
}
