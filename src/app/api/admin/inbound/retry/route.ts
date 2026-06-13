import { getSessionUser } from "@/server/auth/session";
import { retryFailedInboundEvents } from "@/server/email/inbound-retry";
import { recordAuditLog } from "@/server/audit";
import { resolveInboundAdminScope } from "@/server/email/inbound-admin-scope";

export async function POST(request: Request) {
  const user = await getSessionUser();
  const scope = await resolveInboundAdminScope(request, user);
  if (!scope.ok) {
    return scope.response;
  }

  const url = new URL(request.url);
  const limitParam = url.searchParams.get("limit");
  const limit = Math.min(Math.max(Number(limitParam ?? 10) || 10, 1), 50);
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

  const result = await retryFailedInboundEvents({ tenantId: scope.tenantId, limit, eventIds });
  await recordAuditLog({
    tenantId: scope.tenantId,
    actorUserId: scope.actorUserId,
    action: "inbound_retry_triggered",
    entityType: "inbound_events",
    data: {
      authMode: scope.authMode,
      limit,
      eventIdsCount: eventIds.length,
      retried: result.retried,
      failed: result.failed
    }
  });
  return Response.json({ status: "ok", ...result });
}
