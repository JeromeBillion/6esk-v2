import { getSessionUser } from "@/server/auth/session";
import { isLeadAdmin } from "@/server/auth/roles";
import { sessionTenantId } from "@/server/auth/tenant-session";
import { resolveAdminMaintenanceScope } from "@/server/admin-maintenance-scope";
import { listFailedCallOutboxEvents } from "@/server/calls/outbox";
import { redactCallData } from "@/server/calls/redaction";

export async function GET(request: Request) {
  const user = await getSessionUser();
  let tenantId: string | null = null;
  if (isLeadAdmin(user)) {
    tenantId = sessionTenantId(user);
    if (!tenantId) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }
  } else if (user) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  } else {
    const scope = await resolveAdminMaintenanceScope(request, null, {
      sharedSecrets: [process.env.CALLS_OUTBOX_SECRET, process.env.INBOUND_SHARED_SECRET]
    });
    if (!scope.ok) {
      return scope.response;
    }
    tenantId = scope.tenantId;
  }

  const url = new URL(request.url);
  const limitParam = url.searchParams.get("limit");
  const limit = Math.min(Math.max(Number(limitParam ?? 50) || 50, 1), 200);

  const events = await listFailedCallOutboxEvents(limit, tenantId);
  return Response.json({
    events: events.map((event) => redactCallData(event))
  });
}
