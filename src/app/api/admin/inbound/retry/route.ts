import { getSessionUser } from "@/server/auth/session";
import { isLeadAdmin } from "@/server/auth/roles";
import { retryFailedInboundEvents } from "@/server/email/inbound-retry";
import { recordAuditLog } from "@/server/audit";

export async function POST(request: Request) {
  const user = await getSessionUser();
  const sharedSecret = process.env.INBOUND_SHARED_SECRET ?? "";
  const provided = request.headers.get("x-6esk-secret");

  if (!isLeadAdmin(user) && (!sharedSecret || provided !== sharedSecret)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
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

  const result = await retryFailedInboundEvents({ limit, eventIds });
  await recordAuditLog({
    actorUserId: user?.id ?? null,
    action: "inbound_retry_triggered",
    entityType: "inbound_events",
    data: { limit, eventIdsCount: eventIds.length, retried: result.retried, failed: result.failed }
  });
  return Response.json({ status: "ok", ...result });
}
