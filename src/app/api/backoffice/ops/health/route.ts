import { getOpsHealthSnapshot } from "@/server/ops/health";
import { requireBackofficeStaff } from "@/server/backoffice/authz";

export async function GET(request: Request) {
  const auth = await requireBackofficeStaff(request.headers);
  if (!auth.ok) return auth.response;

  const snapshot = await getOpsHealthSnapshot({ tenantId: auth.user.tenant_id ?? null });
  return Response.json(snapshot);
}
