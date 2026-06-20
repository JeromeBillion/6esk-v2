import { getAgentIntegrationById } from "@/server/agents/integrations";
import { cancelAgentRun } from "@/server/agents/run-ledger";
import { recordAuditLog } from "@/server/audit";
import { runInBackground } from "@/server/async";
import { isLeadAdmin } from "@/server/auth/roles";
import { getSessionUser } from "@/server/auth/session";
import { sessionTenantId } from "@/server/auth/tenant-session";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function readCancellationReason(request: Request) {
  const body = await request.json().catch(() => null);
  if (!isRecord(body)) return null;
  const reason = body.reason;
  return typeof reason === "string" && reason.trim() ? reason.trim().slice(0, 500) : null;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ agentId: string; runId: string }> }
) {
  const user = await getSessionUser();
  if (!isLeadAdmin(user)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  const tenantId = sessionTenantId(user);
  if (!tenantId) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { agentId, runId } = await params;
  const integration = await getAgentIntegrationById(agentId, tenantId);
  if (!integration) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const reason = await readCancellationReason(request);
  const actorName = user?.display_name || user?.email || "6esk admin";

  try {
    const result = await cancelAgentRun({
      tenantId,
      integrationId: integration.id,
      runId,
      reason,
      actor: {
        type: "user",
        id: user?.id,
        displayName: actorName
      }
    });

    if (result.reason === "not_found") {
      return Response.json({ error: "Not found" }, { status: 404 });
    }

    if (result.reason === "not_cancellable") {
      await recordAuditLog({
        tenantId,
        actorUserId: user?.id ?? null,
        action: "agent_run_cancel_rejected",
        entityType: "agent_run",
        entityId: runId,
        data: {
          agentId: integration.id,
          previousStatus: result.previousStatus,
          reason
        }
      });

      return Response.json({
        error: "Run is not cancellable",
        status: result.previousStatus
      }, { status: 409 });
    }

    await recordAuditLog({
      tenantId,
      actorUserId: user?.id ?? null,
      action: "agent_run_cancelled",
      entityType: "agent_run",
      entityId: runId,
      data: {
        agentId: integration.id,
        previousStatus: result.previousStatus,
        cancelledSteps: result.cancelledSteps,
        cancelledToolCalls: result.cancelledToolCalls,
        cancelledOutboxEvents: result.cancelledOutboxEvents,
        reason
      }
    });

    return Response.json({ status: "ok", ...result });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Failed to cancel agent run";
    runInBackground(recordAuditLog({
      tenantId,
      actorUserId: user?.id ?? null,
      action: "agent_run_cancel_failed",
      entityType: "agent_run",
      entityId: runId,
      data: {
        agentId: integration.id,
        reason,
        detail
      }
    }), "Failed to record agent run cancel failure audit event", {
      route: "/api/admin/agents/[agentId]/runs/[runId]/cancel",
      tenantId,
      agentId: integration.id,
      runId
    });

    return Response.json({ error: "Failed to cancel agent run", detail }, { status: 500 });
  }
}
