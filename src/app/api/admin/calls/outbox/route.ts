import {
  requireLeadAdminAccess,
  requireLeadAdminOrMachineAccess
} from "@/server/auth/admin-guard";
import { recordAuditLog } from "@/server/audit";
import { deliverPendingCallEvents, getCallOutboxMetrics } from "@/server/calls/outbox";
import { getCallWebhookSecurityConfig } from "@/server/calls/webhook";

export async function GET() {
  const access = await requireLeadAdminAccess();
  if (!access.ok) return access.response;

  const metrics = await getCallOutboxMetrics(access.scope);
  return Response.json({
    ...metrics,
    webhookSecurity: getCallWebhookSecurityConfig()
  });
}

export async function POST(request: Request) {
  const access = await requireLeadAdminOrMachineAccess(request, {
    secretEnvNames: ["CALLS_OUTBOX_SECRET", "INBOUND_SHARED_SECRET"]
  });
  if (!access.ok) return access.response;
  const { user, scope } = access;

  const url = new URL(request.url);
  const limitParam = url.searchParams.get("limit");
  const limit = Math.min(Math.max(Number(limitParam ?? 10) || 10, 1), 100);

  try {
    const result = await deliverPendingCallEvents({ limit }, scope);

    await recordAuditLog({
      tenantKey: scope.tenantKey,
      workspaceKey: scope.workspaceKey,
      actorUserId: user?.id ?? null,
      action: "call_outbox_triggered",
      entityType: "call_outbox_events",
      data: result
    });

    return Response.json({ status: "ok", ...result });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Failed to run call outbox";
    await recordAuditLog({
      tenantKey: scope.tenantKey,
      workspaceKey: scope.workspaceKey,
      actorUserId: user?.id ?? null,
      action: "call_outbox_trigger_failed",
      entityType: "call_outbox_events",
      data: {
        limit,
        detail
      }
    }).catch(() => {});
    return Response.json({ error: "Failed to run call outbox", detail }, { status: 500 });
  }
}
