import { requireLeadAdminOrMachineAccess } from "@/server/auth/admin-guard";
import { retryFailedCallOutboxEvents } from "@/server/calls/outbox";
import { recordAuditLog } from "@/server/audit";

export async function POST(request: Request) {
  const access = await requireLeadAdminOrMachineAccess(request, {
    secretEnvNames: ["CALLS_OUTBOX_SECRET", "INBOUND_SHARED_SECRET"]
  });
  if (!access.ok) return access.response;
  const { user, scope } = access;

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
    const result = await retryFailedCallOutboxEvents({ limit, eventIds }, scope);
    await recordAuditLog({
      tenantKey: scope.tenantKey,
      workspaceKey: scope.workspaceKey,
      actorUserId: user?.id ?? null,
      action: "call_outbox_retry_triggered",
      entityType: "call_outbox_events",
      data: {
        limit,
        eventIdsCount: eventIds.length,
        retried: result.retried
      }
    });

    return Response.json({ status: "ok", ...result });
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "Failed to retry failed call outbox events";
    await recordAuditLog({
      tenantKey: scope.tenantKey,
      workspaceKey: scope.workspaceKey,
      actorUserId: user?.id ?? null,
      action: "call_outbox_retry_failed",
      entityType: "call_outbox_events",
      data: {
        limit,
        detail
      }
    }).catch(() => {});
    return Response.json({ error: "Failed to retry failed call outbox events", detail }, { status: 500 });
  }
}
