import { getSessionUser } from "@/server/auth/session";
import { isLeadAdmin } from "@/server/auth/roles";
import { deliverPendingAgentEvents } from "@/server/agents/outbox";
import { DEFAULT_TENANT_ID } from "@/server/tenant/types";

export async function POST(request: Request) {
  const user = await getSessionUser();
  const sharedSecret = process.env.INBOUND_SHARED_SECRET ?? "";
  const provided = request.headers.get("x-6esk-secret");

  if (!isLeadAdmin(user) && (!sharedSecret || provided !== sharedSecret)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const limitParam = url.searchParams.get("limit");
  const limit = Math.min(Math.max(Number(limitParam ?? 5) || 5, 1), 50);
  const tenantId = user?.tenant_id ?? DEFAULT_TENANT_ID;

  const result = await deliverPendingAgentEvents({ tenantId, limit });
  return Response.json({ status: "ok", ...result });
}
