import {
  requireLeadAdminAccess,
  requireLeadAdminOrMachineAccess
} from "@/server/auth/admin-guard";
import { recordAuditLog } from "@/server/audit";
import { deliverPendingEmailOutboxEvents, getEmailOutboxMetrics } from "@/server/email/outbox";

export async function GET() {
  const access = await requireLeadAdminAccess();
  if (!access.ok) return access.response;

  const metrics = await getEmailOutboxMetrics(access.scope);
  return Response.json(metrics);
}

export async function POST(request: Request) {
  const access = await requireLeadAdminOrMachineAccess(request, {
    secretEnvNames: ["INBOUND_SHARED_SECRET"]
  });
  if (!access.ok) return access.response;
  const { user, scope } = access;

  const url = new URL(request.url);
  const limitParam = url.searchParams.get("limit");
  const limit = Math.min(Math.max(Number(limitParam ?? 10) || 10, 1), 100);

  try {
    const result = await deliverPendingEmailOutboxEvents({ limit }, scope);

    await recordAuditLog({
      tenantKey: scope.tenantKey,
      workspaceKey: scope.workspaceKey,
      actorUserId: user?.id ?? null,
      action: "email_outbox_triggered",
      entityType: "email_outbox_events",
      data: result
    });

    return Response.json({ status: "ok", ...result });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Failed to run email outbox";
    await recordAuditLog({
      tenantKey: scope.tenantKey,
      workspaceKey: scope.workspaceKey,
      actorUserId: user?.id ?? null,
      action: "email_outbox_trigger_failed",
      entityType: "email_outbox_events",
      data: { limit, detail }
    }).catch(() => {});
    return Response.json({ error: "Failed to run email outbox", detail }, { status: 500 });
  }
}
