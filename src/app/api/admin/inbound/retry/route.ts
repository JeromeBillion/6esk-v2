import { requireLeadAdminOrMachineAccess } from "@/server/auth/admin-guard";
import { retryFailedInboundEvents } from "@/server/email/inbound-retry";
import { recordAuditLog } from "@/server/audit";

export async function POST(request: Request) {
  const access = await requireLeadAdminOrMachineAccess(request, {
    secretEnvNames: ["INBOUND_SHARED_SECRET"]
  });
  if (!access.ok) return access.response;
  const { user, scope } = access;

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

  const result = await retryFailedInboundEvents({ limit, eventIds }, scope);
  await recordAuditLog({
    tenantKey: scope.tenantKey,
    workspaceKey: scope.workspaceKey,
    actorUserId: user?.id ?? null,
    action: "inbound_retry_triggered",
    entityType: "inbound_events",
    data: { limit, eventIdsCount: eventIds.length, retried: result.retried, failed: result.failed }
  });
  return Response.json({ status: "ok", ...result });
}
