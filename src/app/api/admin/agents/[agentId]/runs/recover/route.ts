import { getSessionUser } from "@/server/auth/session";
import { isLeadAdmin } from "@/server/auth/roles";
import { getAgentIntegrationById } from "@/server/agents/integrations";
import {
  DEFAULT_AGENT_APPROVAL_STALE_SECONDS,
  DEFAULT_AGENT_RUN_RECOVERY_LIMIT,
  DEFAULT_AGENT_RUN_STALE_SECONDS,
  MAX_STALE_AGENT_RUN_RECOVERY_LIMIT,
  recoverStaleAgentRuns
} from "@/server/agents/run-ledger";
import { recordAuditLog } from "@/server/audit";
import { runInBackground } from "@/server/async";
import { DEFAULT_TENANT_ID } from "@/server/tenant/types";

function readPositiveInteger(value: string | null, fallback: number, max?: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  const normalized = Math.floor(parsed);
  return max ? Math.min(normalized, max) : normalized;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ agentId: string }> }
) {
  const user = await getSessionUser();
  if (!isLeadAdmin(user)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { agentId } = await params;
  const tenantId = user?.tenant_id ?? DEFAULT_TENANT_ID;
  const integration = await getAgentIntegrationById(agentId, tenantId);
  if (!integration) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const url = new URL(request.url);
  const runningStaleSeconds = readPositiveInteger(
    url.searchParams.get("runningStaleSeconds"),
    DEFAULT_AGENT_RUN_STALE_SECONDS
  );
  const approvalStaleSeconds = readPositiveInteger(
    url.searchParams.get("approvalStaleSeconds"),
    DEFAULT_AGENT_APPROVAL_STALE_SECONDS
  );
  const limit = readPositiveInteger(
    url.searchParams.get("limit"),
    DEFAULT_AGENT_RUN_RECOVERY_LIMIT,
    MAX_STALE_AGENT_RUN_RECOVERY_LIMIT
  );

  try {
    const result = await recoverStaleAgentRuns({
      tenantId,
      integrationId: agentId,
      runningStaleSeconds,
      approvalStaleSeconds,
      limit
    });

    await recordAuditLog({
      tenantId,
      actorUserId: user?.id ?? null,
      action: "agent_run_recovery_triggered",
      entityType: "agent_integration",
      entityId: agentId,
      data: {
        runningStaleSeconds,
        approvalStaleSeconds,
        limit,
        recovered: result.recovered,
        retryQueued: result.retryQueued,
        deadLettered: result.deadLettered,
        timedOut: result.timedOut,
        lost: result.lost
      }
    });

    return Response.json({ status: "ok", ...result });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Failed to recover stale agent runs";
    runInBackground(recordAuditLog({
      tenantId,
      actorUserId: user?.id ?? null,
      action: "agent_run_recovery_failed",
      entityType: "agent_integration",
      entityId: agentId,
      data: {
        runningStaleSeconds,
        approvalStaleSeconds,
        limit,
        detail
      }
    }), "Failed to record agent run recovery failure audit event", {
      route: "/api/admin/agents/[agentId]/runs/recover",
      tenantId,
      agentId,
      limit
    });

    return Response.json({ error: "Failed to recover stale agent runs", detail }, { status: 500 });
  }
}
