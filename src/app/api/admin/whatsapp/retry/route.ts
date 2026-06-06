import { requireLeadAdminOrMachineAccess } from "@/server/auth/admin-guard";
import { recordAuditLog } from "@/server/audit";
import { retryFailedWhatsAppEvents } from "@/server/whatsapp/outbox";

export async function POST(request: Request) {
  const access = await requireLeadAdminOrMachineAccess(request, {
    secretEnvNames: ["WHATSAPP_OUTBOX_SECRET", "INBOUND_SHARED_SECRET"]
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
    const result = await retryFailedWhatsAppEvents({ limit, eventIds }, scope);
    await recordAuditLog({
      tenantKey: scope.tenantKey,
      workspaceKey: scope.workspaceKey,
      actorUserId: user?.id ?? null,
      action: "whatsapp_outbox_retry_triggered",
      entityType: "whatsapp_events",
      data: {
        limit,
        eventIdsCount: eventIds.length,
        retried: result.retried
      }
    });

    return Response.json({ status: "ok", ...result });
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "Failed to retry failed WhatsApp outbox events";
    await recordAuditLog({
      tenantKey: scope.tenantKey,
      workspaceKey: scope.workspaceKey,
      actorUserId: user?.id ?? null,
      action: "whatsapp_outbox_retry_failed",
      entityType: "whatsapp_events",
      data: { limit, detail }
    }).catch(() => {});
    return Response.json(
      { error: "Failed to retry failed WhatsApp outbox events", detail },
      { status: 500 }
    );
  }
}
