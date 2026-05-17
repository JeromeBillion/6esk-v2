import { getSessionUser } from "@/server/auth/session";
import { isInternalStaff } from "@/server/auth/roles";
import { getSecurityReadinessSnapshot } from "@/server/security/readiness";

export async function GET() {
  const user = await getSessionUser();
  if (!isInternalStaff(user)) {
    return Response.json({ error: "Forbidden. 6esk Staff only." }, { status: 403 });
  }

  const snapshot = await getSecurityReadinessSnapshot();
  return Response.json(snapshot);
}
