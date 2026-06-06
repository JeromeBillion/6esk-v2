import { getSessionUser } from "@/server/auth/session";
import { isLeadAdmin } from "@/server/auth/roles";
import { getDexterRuntimeStatus } from "@/server/dexter-runtime";

export async function GET() {
  const user = await getSessionUser();
  if (!isLeadAdmin(user)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  return Response.json({ runtime: getDexterRuntimeStatus() });
}
