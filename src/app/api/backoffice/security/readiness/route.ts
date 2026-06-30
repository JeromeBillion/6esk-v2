import { requireBackofficeStaff } from "@/server/backoffice/authz";
import { getSecurityReadinessSnapshot } from "@/server/security/readiness";

export async function GET(request: Request) {
  const auth = await requireBackofficeStaff(request.headers);
  if (!auth.ok) return auth.response;

  const snapshot = await getSecurityReadinessSnapshot();
  return Response.json(snapshot);
}
