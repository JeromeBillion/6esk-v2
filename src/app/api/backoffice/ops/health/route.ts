import { getSessionUser } from "@/server/auth/session";
import { isInternalStaff } from "@/server/auth/roles";
import { getOpsHealthSnapshot } from "@/server/ops/health";

export async function GET() {
  const user = await getSessionUser();
  if (!isInternalStaff(user)) {
    return Response.json({ error: "Forbidden. 6esk Staff only." }, { status: 403 });
  }

  const snapshot = await getOpsHealthSnapshot({ tenantId: user?.tenant_id ?? null });
  return Response.json(snapshot);
}
