import { db } from "@/server/db";
import { getAgentIntegrationById } from "@/server/agents/integrations";
import { parseMaxEventsPerRun, resolveDeliveryLimit } from "@/server/agents/throughput";

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

function toNumber(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toIso(value: Date | null | undefined) {
  return value ? value.toISOString() : null;
}

export async function getAgentOutboxMetrics(
  agentId: string,
  requestedLimit?: number | null
) {
  const integration = await getAgentIntegrationById(agentId);
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
     WHERE integration_id = $1`,
    [integration.id]
  );

  const errorResult = await db.query<OutboxErrorRow>(
    `SELECT last_error
     FROM agent_outbox
     WHERE integration_id = $1
       AND status = 'failed'
       AND last_error IS NOT NULL
     ORDER BY updated_at DESC
     LIMIT 1`,
    [integration.id]
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
    }
  };
}
