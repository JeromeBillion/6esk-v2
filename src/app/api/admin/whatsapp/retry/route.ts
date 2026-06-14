import { getSessionUser } from "@/server/auth/session";
import { recordAuditLog } from "@/server/audit";
import { runInBackground } from "@/server/async";
import { resolveAdminMaintenanceScope } from "@/server/admin-maintenance-scope";
import { retryFailedWhatsAppEvents } from "@/server/whatsapp/outbox";

export async function POST(request: Request) {
  const user = await getSessionUser();
  const scope = await resolveAdminMaintenanceScope(request, user, {
    sharedSecrets: [process.env.WHATSAPP_OUTBOX_SECRET, process.env.INBOUND_SHARED_SECRET]
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
    const result = await retryFailedWhatsAppEvents({ limit, eventIds, tenantId: scope.tenantId });
    await recordAuditLog({
      tenantId: scope.tenantId,
      actorUserId: scope.actorUserId,
      action: "whatsapp_outbox_retry_triggered",
      entityType: "whatsapp_events",
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
      error instanceof Error ? error.message : "Failed to retry failed WhatsApp outbox events";
    runInBackground(recordAuditLog({
      tenantId: scope.tenantId,
      actorUserId: scope.actorUserId,
      action: "whatsapp_outbox_retry_failed",
      entityType: "whatsapp_events",
      data: { authMode: scope.authMode, limit, detail }
    }), "Failed to record WhatsApp outbox retry failure audit event", {
      tenantId: scope.tenantId,
      actorUserId: scope.actorUserId,
      limit
    });
    return Response.json(
      { error: "Failed to retry failed WhatsApp outbox events", detail },
      { status: 500 }
    );
  }
}
