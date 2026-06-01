import { getSessionUser } from "@/server/auth/session";
import { isLeadAdmin } from "@/server/auth/roles";
import { recordAuditLog } from "@/server/audit";
import { deliverPendingCallEvents, getCallOutboxMetrics } from "@/server/calls/outbox";
import { getCallWebhookSecurityConfig } from "@/server/calls/webhook";
import {
  isTenantIngressScopeError,
  tenantScopeFromMachineRequestAsync,
  tenantScopeFromUser
} from "@/server/tenant-context";

export async function GET() {
  const user = await getSessionUser();
  if (!isLeadAdmin(user)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const scope = tenantScopeFromUser(user);
  const metrics = await getCallOutboxMetrics(scope);
  return Response.json({
    ...metrics,
    webhookSecurity: getCallWebhookSecurityConfig()
  });
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  const sharedSecret =
    process.env.CALLS_OUTBOX_SECRET ?? process.env.INBOUND_SHARED_SECRET ?? "";
  const provided = request.headers.get("x-6esk-secret");

  if (!isLeadAdmin(user) && (!sharedSecret || provided !== sharedSecret)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  let scope;
  try {
    scope = user ? tenantScopeFromUser(user) : await tenantScopeFromMachineRequestAsync(request);
  } catch (error) {
    if (isTenantIngressScopeError(error)) {
      return Response.json({ error: error.message, code: error.code }, { status: error.status });
    }
    throw error;
  }

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
