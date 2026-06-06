import { getSessionUser } from "@/server/auth/session";
import { isLeadAdmin } from "@/server/auth/roles";
import { getInboundMetrics } from "@/server/email/inbound-metrics";

export async function GET(request: Request) {
  const user = await getSessionUser();
  const sharedSecret = process.env.INBOUND_SHARED_SECRET ?? "";
  const provided = request.headers.get("x-6esk-secret");

  if (!isLeadAdmin(user) && (!sharedSecret || provided !== sharedSecret)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const requestedHours = Number(url.searchParams.get("hours") ?? 24) || 24;
  const metrics = await getInboundMetrics(requestedHours);
  return Response.json(metrics);
}
