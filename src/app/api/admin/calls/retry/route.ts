import { getSessionUser } from "@/server/auth/session";
import { retryFailedCallOutboxEvents } from "@/server/calls/outbox";
import { recordAuditLog } from "@/server/audit";
import { runInBackground } from "@/server/async";
import { resolveAdminMaintenanceScope } from "@/server/admin-maintenance-scope";

export async function POST(request: Request) {
  const user = await getSessionUser();
  const scope = await resolveAdminMaintenanceScope(request, user, {
    sharedSecrets: [process.env.CALLS_OUTBOX_SECRET, process.env.INBOUND_SHARED_SECRET]
  });
  if (!scope.ok) {
    return scope.response;
  }

  const url = new URL(request.url);
  const limitParam = url.searchParams.get("limit");
  const limit = Math.min(Math.max(Number(limitParam ?? 25) || 25, 1), 100);
  let eventIds: string[] = [];
  try {
    const payload = (await request.json()) as { eventIds?: unknown };
    if (Array.isArray(payload?.eventIds)) {
      eventIds = payload.eventIds
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim())
        .filter(Boolean)
        .slice(0, 100);
    }
  } catch {
    eventIds = [];
  }

  try {
    const result = await retryFailedCallOutboxEvents({ limit, eventIds, tenantId: scope.tenantId });
    await recordAuditLog({
      tenantId: scope.tenantId,
      actorUserId: scope.actorUserId,
      action: "call_outbox_retry_triggered",
      entityType: "call_outbox_events",
      data: {
        authMode: scope.authMode,
        limit,
        eventIdsCount: eventIds.length,
        retried: result.retried
      }
    });

    return Response.json({ status: "ok", ...result });
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "Failed to retry failed call outbox events";
    runInBackground(recordAuditLog({
      tenantId: scope.tenantId,
      actorUserId: scope.actorUserId,
      action: "call_outbox_retry_failed",
      entityType: "call_outbox_events",
      data: {
        authMode: scope.authMode,
        limit,
        detail
      }
    }), "Failed to record call outbox retry failure audit event", {
      route: "/api/admin/calls/retry",
      tenantId: scope.tenantId,
      limit
    });
    return Response.json({ error: "Failed to retry failed call outbox events", detail }, { status: 500 });
  }
}
