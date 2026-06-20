import { getAgentIntegrationById } from "@/server/agents/integrations";
import {
  AGENT_RUN_STATUSES,
  listRecentAgentRuns,
  type AgentRunListRow,
  type AgentRunStatus
} from "@/server/agents/run-ledger";
import { redactPromptSafetySample } from "@/server/ai/prompt-safety";
import { isLeadAdmin } from "@/server/auth/roles";
import { getSessionUser } from "@/server/auth/session";
import { sessionTenantId } from "@/server/auth/tenant-session";

const ACTIVE_RUN_STATUSES: AgentRunStatus[] = ["queued", "running", "waiting_approval"];

function readLimit(request: Request) {
  const url = new URL(request.url);
  const parsed = Number.parseInt(url.searchParams.get("limit") ?? "25", 10);
  if (!Number.isFinite(parsed)) return 25;
  return Math.min(Math.max(parsed, 1), 100);
}

function parseStatuses(request: Request): AgentRunStatus[] {
  const url = new URL(request.url);
  if (url.searchParams.get("activeOnly") === "true") {
    return ACTIVE_RUN_STATUSES;
  }
  const raw = url.searchParams.get("status");
  if (!raw) return [];
  const allowed = new Set(AGENT_RUN_STATUSES);
  return Array.from(new Set(
    raw
      .split(",")
      .map((status) => status.trim())
      .filter((status): status is AgentRunStatus => allowed.has(status as AgentRunStatus))
  ));
}

function iso(value: Date | string | null) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return value;
}

function redactFailureReason(value: string | null) {
  if (!value) return null;
  return redactPromptSafetySample(value)
    .replace(
      /\b(api[_-]?key|token|secret|password|credential)\s*[:=]\s*[^\s,;]+/gi,
      "$1=[REDACTED]"
    )
    .slice(0, 500);
}

function serializeRun(row: AgentRunListRow) {
  return {
    id: row.id,
    integrationId: row.integration_id,
    runType: row.run_type,
    status: row.status,
    laneKey: row.lane_key,
    sourceChannel: row.source_channel,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    triggerEventType: row.trigger_event_type,
    triggerOutboxId: row.trigger_outbox_id,
    hasIdempotencyKey: Boolean(row.idempotency_key),
    rolloutMode: row.rollout_mode,
    providerMode: row.provider_mode,
    failureReason: redactFailureReason(row.failure_reason),
    createdAt: iso(row.created_at),
    queuedAt: iso(row.queued_at),
    startedAt: iso(row.started_at),
    completedAt: iso(row.completed_at),
    failedAt: iso(row.failed_at),
    updatedAt: iso(row.updated_at)
  };
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ agentId: string }> }
) {
  const user = await getSessionUser();
  if (!isLeadAdmin(user)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  const tenantId = sessionTenantId(user);
  if (!tenantId) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { agentId } = await params;
  const integration = await getAgentIntegrationById(agentId, tenantId);
  if (!integration) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const statuses = parseStatuses(request);
  const limit = readLimit(request);
  const runs = await listRecentAgentRuns({
    tenantId,
    integrationId: integration.id,
    statuses,
    limit
  });

  return Response.json({
    runs: runs.map(serializeRun),
    filters: {
      limit,
      statuses
    }
  });
}
