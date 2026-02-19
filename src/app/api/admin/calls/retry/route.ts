import { getSessionUser } from "@/server/auth/session";
import { isLeadAdmin } from "@/server/auth/roles";
import { retryFailedCallOutboxEvents } from "@/server/calls/outbox";
import { recordAuditLog } from "@/server/audit";

export async function POST(request: Request) {
  const user = await getSessionUser();
  const sharedSecret =
    process.env.CALLS_OUTBOX_SECRET ?? process.env.INBOUND_SHARED_SECRET ?? "";
  const provided = request.headers.get("x-6esk-secret");

  if (!isLeadAdmin(user) && (!sharedSecret || provided !== sharedSecret)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const limitParam = url.searchParams.get("limit");
  const limit = Math.min(Math.max(Number(limitParam ?? 25) || 25, 1), 100);

  try {
    const result = await retryFailedCallOutboxEvents(limit);
    await recordAuditLog({
      actorUserId: user?.id ?? null,
      action: "call_outbox_retry_triggered",
      entityType: "call_outbox_events",
      data: {
        limit,
        retried: result.retried
      }
    });

    return Response.json({ status: "ok", ...result });
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "Failed to retry failed call outbox events";
    await recordAuditLog({
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
