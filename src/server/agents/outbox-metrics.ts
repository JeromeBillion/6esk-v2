import { db } from "@/server/db";
import { getAgentIntegrationById } from "@/server/agents/integrations";
import { parseMaxEventsPerRun, resolveDeliveryLimit } from "@/server/agents/throughput";
import { DEFAULT_AGENT_RUN_STALE_SECONDS } from "@/server/agents/run-ledger";

type OutboxSummaryRow = {
  pending: number | string | null;
  due_now: number | string | null;
  processing: number | string | null;
  failed: number | string | null;
  delivered_total: number | string | null;
  delivered_24h: number | string | null;
  next_attempt_at: Date | null;
  last_delivered_at: Date | null;
  last_failed_at: Date | null;
};

type OutboxErrorRow = {
  last_error: string | null;
};

type RunSummaryRow = {
  queued: number | string | null;
  running: number | string | null;
  waiting_approval: number | string | null;
  timed_out: number | string | null;
  lost: number | string | null;
  failed: number | string | null;
  stale_active: number | string | null;
  oldest_queued_at: Date | null;
  oldest_active_at: Date | null;
};

type LaneSummaryRow = {
  lane_key: string;
  queued: number | string | null;
  running: number | string | null;
  waiting_approval: number | string | null;
  stale_active: number | string | null;
  oldest_queued_at: Date | null;
  oldest_active_at: Date | null;
  oldest_wait_seconds: number | string | null;
};

type ToolCallSummaryRow = {
  requested: number | string | null;
  approved: number | string | null;
  denied: number | string | null;
  running: number | string | null;
  completed: number | string | null;
  failed: number | string | null;
  cancelled: number | string | null;
  last_denied_at: Date | null;
  last_failed_at: Date | null;
};

function toNumber(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toIso(value: Date | null | undefined) {
  return value ? value.toISOString() : null;
}

export async function getAgentOutboxMetrics(
  agentId: string,
  requestedLimit?: number | null,
  tenantId?: string | null
) {
  const integration = await getAgentIntegrationById(agentId, tenantId);
  if (!integration) {
    return null;
  }

  const summaryResult = await db.query<OutboxSummaryRow>(
    `SELECT
       COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
       COUNT(*) FILTER (WHERE status = 'pending' AND next_attempt_at <= now())::int AS due_now,
       COUNT(*) FILTER (WHERE status = 'processing')::int AS processing,
       COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
       COUNT(*) FILTER (WHERE status = 'delivered')::int AS delivered_total,
       COUNT(*) FILTER (
         WHERE status = 'delivered'
           AND updated_at >= now() - interval '24 hours'
       )::int AS delivered_24h,
       MIN(next_attempt_at) FILTER (WHERE status = 'pending') AS next_attempt_at,
       MAX(updated_at) FILTER (WHERE status = 'delivered') AS last_delivered_at,
       MAX(updated_at) FILTER (WHERE status = 'failed') AS last_failed_at
     FROM agent_outbox
     WHERE integration_id = $1
       AND tenant_id = $2`,
    [integration.id, integration.tenant_id]
  );

  const errorResult = await db.query<OutboxErrorRow>(
    `SELECT last_error
     FROM agent_outbox
     WHERE integration_id = $1
       AND tenant_id = $2
       AND status = 'failed'
       AND last_error IS NOT NULL
     ORDER BY updated_at DESC
     LIMIT 1`,
    [integration.id, integration.tenant_id]
  );

  const runSummaryResult = await db.query<RunSummaryRow>(
    `SELECT
       COUNT(*) FILTER (WHERE status = 'queued')::int AS queued,
       COUNT(*) FILTER (WHERE status = 'running')::int AS running,
       COUNT(*) FILTER (WHERE status = 'waiting_approval')::int AS waiting_approval,
       COUNT(*) FILTER (WHERE status = 'timed_out')::int AS timed_out,
       COUNT(*) FILTER (WHERE status = 'lost')::int AS lost,
       COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
       COUNT(*) FILTER (
         WHERE status IN ('running', 'waiting_approval')
           AND updated_at <= now() - make_interval(secs => $3::int)
       )::int AS stale_active,
       MIN(queued_at) FILTER (WHERE status = 'queued') AS oldest_queued_at,
       MIN(updated_at) FILTER (WHERE status IN ('running', 'waiting_approval')) AS oldest_active_at
     FROM agent_runs
     WHERE tenant_id = $1
       AND integration_id = $2`,
    [integration.tenant_id, integration.id, DEFAULT_AGENT_RUN_STALE_SECONDS]
  );

  const laneResult = await db.query<LaneSummaryRow>(
    `SELECT
       lane_key,
       COUNT(*) FILTER (WHERE status = 'queued')::int AS queued,
       COUNT(*) FILTER (WHERE status = 'running')::int AS running,
       COUNT(*) FILTER (WHERE status = 'waiting_approval')::int AS waiting_approval,
       COUNT(*) FILTER (
         WHERE status IN ('running', 'waiting_approval')
           AND updated_at <= now() - make_interval(secs => $3::int)
       )::int AS stale_active,
       MIN(queued_at) FILTER (WHERE status = 'queued') AS oldest_queued_at,
       MIN(updated_at) FILTER (WHERE status IN ('running', 'waiting_approval')) AS oldest_active_at,
       EXTRACT(EPOCH FROM (now() - MIN(CASE WHEN status = 'queued' THEN queued_at END)))::int
         AS oldest_wait_seconds
     FROM agent_runs
     WHERE tenant_id = $1
       AND integration_id = $2
       AND status IN ('queued', 'running', 'waiting_approval')
     GROUP BY lane_key
     HAVING COUNT(*) FILTER (WHERE status IN ('queued', 'running', 'waiting_approval')) > 0
     ORDER BY
       COUNT(*) FILTER (WHERE status IN ('running', 'waiting_approval')) DESC,
       COUNT(*) FILTER (WHERE status = 'queued') DESC,
       MIN(queued_at) FILTER (WHERE status = 'queued') ASC NULLS LAST
     LIMIT 10`,
    [integration.tenant_id, integration.id, DEFAULT_AGENT_RUN_STALE_SECONDS]
  );

  const toolCallResult = await db.query<ToolCallSummaryRow>(
    `SELECT
       COUNT(*) FILTER (WHERE tool.status = 'requested')::int AS requested,
       COUNT(*) FILTER (WHERE tool.status = 'approved')::int AS approved,
       COUNT(*) FILTER (WHERE tool.status = 'denied')::int AS denied,
       COUNT(*) FILTER (WHERE tool.status = 'running')::int AS running,
       COUNT(*) FILTER (WHERE tool.status = 'completed')::int AS completed,
       COUNT(*) FILTER (WHERE tool.status = 'failed')::int AS failed,
       COUNT(*) FILTER (WHERE tool.status = 'cancelled')::int AS cancelled,
       MAX(tool.updated_at) FILTER (WHERE tool.status = 'denied') AS last_denied_at,
       MAX(tool.updated_at) FILTER (WHERE tool.status = 'failed') AS last_failed_at
     FROM agent_tool_calls tool
     JOIN agent_runs run
       ON run.tenant_id = tool.tenant_id
      AND run.id = tool.run_id
     WHERE tool.tenant_id = $1
       AND run.integration_id = $2`,
    [integration.tenant_id, integration.id]
  );

  const summary = summaryResult.rows[0] ?? {
    pending: 0,
    due_now: 0,
    processing: 0,
    failed: 0,
    delivered_total: 0,
    delivered_24h: 0,
    next_attempt_at: null,
    last_delivered_at: null,
    last_failed_at: null
  };
  const runSummary = runSummaryResult.rows[0] ?? {
    queued: 0,
    running: 0,
    waiting_approval: 0,
    timed_out: 0,
    lost: 0,
    failed: 0,
    stale_active: 0,
    oldest_queued_at: null,
    oldest_active_at: null
  };
  const toolCallSummary = toolCallResult.rows[0] ?? {
    requested: 0,
    approved: 0,
    denied: 0,
    running: 0,
    completed: 0,
    failed: 0,
    cancelled: 0,
    last_denied_at: null,
    last_failed_at: null
  };

  return {
    integrationId: integration.id,
    integrationStatus: integration.status,
    throughput: {
      configuredMaxEventsPerRun: parseMaxEventsPerRun(integration.capabilities),
      effectiveLimit: resolveDeliveryLimit({
        requestedLimit,
        capabilities: integration.capabilities
      })
    },
    queue: {
      pending: toNumber(summary.pending),
      dueNow: toNumber(summary.due_now),
      processing: toNumber(summary.processing),
      failed: toNumber(summary.failed),
      deliveredTotal: toNumber(summary.delivered_total),
      delivered24h: toNumber(summary.delivered_24h),
      nextAttemptAt: toIso(summary.next_attempt_at),
      lastDeliveredAt: toIso(summary.last_delivered_at),
      lastFailedAt: toIso(summary.last_failed_at),
      lastError: errorResult.rows[0]?.last_error ?? null
    },
    runs: {
      queued: toNumber(runSummary.queued),
      running: toNumber(runSummary.running),
      waitingApproval: toNumber(runSummary.waiting_approval),
      timedOut: toNumber(runSummary.timed_out),
      lost: toNumber(runSummary.lost),
      failed: toNumber(runSummary.failed),
      staleActive: toNumber(runSummary.stale_active),
      oldestQueuedAt: toIso(runSummary.oldest_queued_at),
      oldestActiveAt: toIso(runSummary.oldest_active_at),
      staleAfterSeconds: DEFAULT_AGENT_RUN_STALE_SECONDS
    },
    lanes: {
      top: laneResult.rows.map((lane) => ({
        laneKey: lane.lane_key,
        queued: toNumber(lane.queued),
        running: toNumber(lane.running),
        waitingApproval: toNumber(lane.waiting_approval),
        staleActive: toNumber(lane.stale_active),
        oldestQueuedAt: toIso(lane.oldest_queued_at),
        oldestActiveAt: toIso(lane.oldest_active_at),
        oldestWaitSeconds: toNumber(lane.oldest_wait_seconds)
      }))
    },
    toolCalls: {
      requested: toNumber(toolCallSummary.requested),
      approved: toNumber(toolCallSummary.approved),
      denied: toNumber(toolCallSummary.denied),
      running: toNumber(toolCallSummary.running),
      completed: toNumber(toolCallSummary.completed),
      failed: toNumber(toolCallSummary.failed),
      cancelled: toNumber(toolCallSummary.cancelled),
      lastDeniedAt: toIso(toolCallSummary.last_denied_at),
      lastFailedAt: toIso(toolCallSummary.last_failed_at)
    }
  };
}
