import { db } from "@/server/db";
import { updateCallSessionStatus } from "@/server/calls/service";
import { sendOutboundCall } from "@/server/calls/provider";
import { resolveTenantScope, type TenantScopeInput } from "@/server/tenant-context";

type CallOutboxEventRow = {
  id: string;
  tenant_key: string;
  workspace_key: string;
  payload: Record<string, unknown>;
  attempt_count: number;
};

export type FailedCallOutboxEvent = {
  id: string;
  status: string;
  attempt_count: number;
  last_error: string | null;
  next_attempt_at: Date | null;
  created_at: Date;
  updated_at: Date;
  payload: Record<string, unknown>;
};

type DeliverCallOutboxArgs = {
  limit?: number;
};

type CallOutboxSummaryRow = {
  queued: number | string | null;
  due_now: number | string | null;
  processing: number | string | null;
  failed: number | string | null;
  sent_total: number | string | null;
  sent_24h: number | string | null;
  next_attempt_at: Date | null;
  last_sent_at: Date | null;
  last_failed_at: Date | null;
};

type CallOutboxErrorRow = {
  last_error: string | null;
};

function toNumber(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toIso(value: Date | null | undefined) {
  return value ? value.toISOString() : null;
}

function getCallProvider() {
  const configured = (process.env.CALLS_PROVIDER ?? "mock").trim().toLowerCase();
  return configured || "mock";
}

const DEFAULT_PROCESSING_RECOVERY_SECONDS = 300;

function getProcessingRecoverySeconds() {
  const configured = Number(process.env.CALLS_OUTBOX_PROCESSING_RECOVERY_SECONDS ?? "300");
  if (!Number.isFinite(configured) || configured <= 0) {
    return DEFAULT_PROCESSING_RECOVERY_SECONDS;
  }
  return Math.floor(configured);
}

async function lockPendingEvents(
  limit: number,
  processingRecoverySeconds: number,
  scopeInput?: TenantScopeInput
): Promise<CallOutboxEventRow[]> {
  const scope = scopeInput ? resolveTenantScope(scopeInput) : null;
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<CallOutboxEventRow>(
      `UPDATE call_outbox_events
       SET status = 'processing',
           last_error = NULL,
           updated_at = now()
       WHERE id IN (
         SELECT id
         FROM call_outbox_events
         WHERE direction = 'outbound'
           ${scope ? "AND tenant_key = $3" : ""}
           ${scope ? "AND workspace_key = $4" : ""}
           AND (
             (status = 'queued' AND next_attempt_at <= now())
             OR (
               status = 'processing'
               AND updated_at <= now() - make_interval(secs => $2::int)
             )
           )
         ORDER BY created_at ASC
         LIMIT $1
         FOR UPDATE SKIP LOCKED
       )
       RETURNING id, tenant_key, workspace_key, payload, attempt_count`,
      scope
        ? [limit, processingRecoverySeconds, scope.tenantKey, scope.workspaceKey]
        : [limit, processingRecoverySeconds]
    );
    await client.query("COMMIT");
    return result.rows;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function markDelivered({
  eventId,
  tenantKey,
  workspaceKey,
  callSessionId,
  provider,
  providerCallId
}: {
  eventId: string;
  tenantKey: string;
  workspaceKey: string;
  callSessionId: string | null;
  provider: string;
  providerCallId: string | null;
}) {
  await db.query(
    `UPDATE call_outbox_events
     SET status = 'sent',
         updated_at = now()
     WHERE id = $1
       AND tenant_key = $2
       AND workspace_key = $3`,
    [eventId, tenantKey, workspaceKey]
  );

  if (!callSessionId) {
    return;
  }

  await updateCallSessionStatus({
    callSessionId,
    provider,
    providerCallId,
    status: "dialing",
    occurredAt: new Date(),
    payload: {
      source: "outbox",
      eventId
    }
  });
}

async function markFailed({
  eventId,
  tenantKey,
  workspaceKey,
  attemptCount,
  errorMessage,
  callSessionId
}: {
  eventId: string;
  tenantKey: string;
  workspaceKey: string;
  attemptCount: number;
  errorMessage: string;
  callSessionId: string | null;
}) {
  const nextAttempt = new Date(Date.now() + Math.min(attemptCount, 5) * 60000);
  const status = attemptCount >= 5 ? "failed" : "queued";

  await db.query(
    `UPDATE call_outbox_events
     SET status = $1,
         attempt_count = $2,
         last_error = $3,
         next_attempt_at = $4,
         updated_at = now()
     WHERE id = $5
       AND tenant_key = $6
       AND workspace_key = $7`,
    [
      status,
      attemptCount,
      errorMessage.slice(0, 500),
      nextAttempt,
      eventId,
      tenantKey,
      workspaceKey
    ]
  );

  if (status === "failed" && callSessionId) {
    await updateCallSessionStatus({
      callSessionId,
      status: "failed",
      occurredAt: new Date(),
      payload: {
        source: "outbox",
        eventId,
        error: errorMessage.slice(0, 500)
      }
    });
  }
}

export async function deliverPendingCallEvents(
  { limit = 5 }: DeliverCallOutboxArgs = {},
  scopeInput?: TenantScopeInput
) {
  const provider = getCallProvider();
  const pending = await lockPendingEvents(limit, getProcessingRecoverySeconds(), scopeInput);
  if (!pending.length) {
    return { delivered: 0, skipped: 0, provider };
  }

  let delivered = 0;
  for (const event of pending) {
    const payload = event.payload ?? {};
    const eventScope = resolveTenantScope({
      tenantKey: event.tenant_key,
      workspaceKey: event.workspace_key
    });
    const callSessionId =
      typeof payload.callSessionId === "string" ? payload.callSessionId : null;
    try {
      const { providerCallId } = await sendOutboundCall(provider, event.id, payload, {
        tenantKey: eventScope.tenantKey,
        workspaceKey: eventScope.workspaceKey
      });
      await markDelivered({
        eventId: event.id,
        tenantKey: eventScope.tenantKey,
        workspaceKey: eventScope.workspaceKey,
        callSessionId,
        provider,
        providerCallId
      });
      delivered += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Call delivery failed";
      await markFailed({
        eventId: event.id,
        tenantKey: eventScope.tenantKey,
        workspaceKey: eventScope.workspaceKey,
        attemptCount: event.attempt_count + 1,
        errorMessage: message,
        callSessionId
      });
    }
  }

  return { delivered, skipped: pending.length - delivered, provider };
}

export async function getCallOutboxMetrics(scopeInput?: TenantScopeInput) {
  const scope = scopeInput ? resolveTenantScope(scopeInput) : null;
  const provider = getCallProvider();
  const summaryResult = await db.query<CallOutboxSummaryRow>(
    `SELECT
       COUNT(*) FILTER (WHERE status = 'queued')::int AS queued,
       COUNT(*) FILTER (WHERE status = 'queued' AND next_attempt_at <= now())::int AS due_now,
       COUNT(*) FILTER (WHERE status = 'processing')::int AS processing,
       COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
       COUNT(*) FILTER (WHERE status = 'sent')::int AS sent_total,
       COUNT(*) FILTER (
         WHERE status = 'sent'
           AND updated_at >= now() - interval '24 hours'
       )::int AS sent_24h,
       MIN(next_attempt_at) FILTER (WHERE status = 'queued') AS next_attempt_at,
       MAX(updated_at) FILTER (WHERE status = 'sent') AS last_sent_at,
       MAX(updated_at) FILTER (WHERE status = 'failed') AS last_failed_at
     FROM call_outbox_events
     WHERE direction = 'outbound'
       ${scope ? "AND tenant_key = $1" : ""}
       ${scope ? "AND workspace_key = $2" : ""}`,
    scope ? [scope.tenantKey, scope.workspaceKey] : []
  );

  const errorResult = await db.query<CallOutboxErrorRow>(
    `SELECT last_error
     FROM call_outbox_events
     WHERE direction = 'outbound'
       ${scope ? "AND tenant_key = $1" : ""}
       ${scope ? "AND workspace_key = $2" : ""}
       AND status = 'failed'
       AND last_error IS NOT NULL
     ORDER BY updated_at DESC
     LIMIT 1`,
    scope ? [scope.tenantKey, scope.workspaceKey] : []
  );

  const summary = summaryResult.rows[0] ?? {
    queued: 0,
    due_now: 0,
    processing: 0,
    failed: 0,
    sent_total: 0,
    sent_24h: 0,
    next_attempt_at: null,
    last_sent_at: null,
    last_failed_at: null
  };

  return {
    provider,
    queue: {
      queued: toNumber(summary.queued),
      dueNow: toNumber(summary.due_now),
      processing: toNumber(summary.processing),
      failed: toNumber(summary.failed),
      sentTotal: toNumber(summary.sent_total),
      sent24h: toNumber(summary.sent_24h),
      nextAttemptAt: toIso(summary.next_attempt_at),
      lastSentAt: toIso(summary.last_sent_at),
      lastFailedAt: toIso(summary.last_failed_at),
      lastError: errorResult.rows[0]?.last_error ?? null
    }
  };
}

export async function listFailedCallOutboxEvents(limit = 50, scopeInput?: TenantScopeInput) {
  const scope = scopeInput ? resolveTenantScope(scopeInput) : null;
  const normalizedLimit = Math.min(Math.max(limit, 1), 200);
  const result = await db.query<FailedCallOutboxEvent>(
    `SELECT
       id,
       status,
       attempt_count,
       last_error,
       next_attempt_at,
       created_at,
       updated_at,
       payload
     FROM call_outbox_events
     WHERE direction = 'outbound'
       ${scope ? "AND tenant_key = $2" : ""}
       ${scope ? "AND workspace_key = $3" : ""}
       AND status = 'failed'
     ORDER BY updated_at DESC
     LIMIT $1`,
    scope ? [normalizedLimit, scope.tenantKey, scope.workspaceKey] : [normalizedLimit]
  );
  return result.rows;
}

type RetryFailedCallOutboxInput = {
  limit?: number;
  eventIds?: string[];
};

export async function retryFailedCallOutboxEvents(
  input: RetryFailedCallOutboxInput | number = {},
  scopeInput?: TenantScopeInput
) {
  const scope = scopeInput ? resolveTenantScope(scopeInput) : null;
  const normalizedInput = typeof input === "number" ? { limit: input } : input;
  const normalizedLimit = Math.min(Math.max(normalizedInput.limit ?? 25, 1), 100);
  const eventIds = Array.from(
    new Set((normalizedInput.eventIds ?? []).map((value) => value.trim()).filter(Boolean))
  ).slice(0, 100);
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const result =
      eventIds.length > 0
        ? await client.query<{ id: string }>(
            `UPDATE call_outbox_events
             SET status = 'queued',
                 next_attempt_at = now(),
                 updated_at = now()
             WHERE direction = 'outbound'
               AND status = 'failed'
               ${scope ? "AND tenant_key = $2" : ""}
               ${scope ? "AND workspace_key = $3" : ""}
               AND id::text = ANY($1::text[])
             RETURNING id`,
            scope ? [eventIds, scope.tenantKey, scope.workspaceKey] : [eventIds]
          )
        : await client.query<{ id: string }>(
            `WITH failed AS (
               SELECT id
               FROM call_outbox_events
               WHERE direction = 'outbound'
                 AND status = 'failed'
                 ${scope ? "AND tenant_key = $2" : ""}
                 ${scope ? "AND workspace_key = $3" : ""}
               ORDER BY updated_at ASC
               LIMIT $1
               FOR UPDATE SKIP LOCKED
             )
             UPDATE call_outbox_events evt
             SET status = 'queued',
                 next_attempt_at = now(),
                 updated_at = now()
             FROM failed
             WHERE evt.id = failed.id
               ${scope ? "AND evt.tenant_key = $2" : ""}
               ${scope ? "AND evt.workspace_key = $3" : ""}
             RETURNING evt.id`,
            scope ? [normalizedLimit, scope.tenantKey, scope.workspaceKey] : [normalizedLimit]
          );
    await client.query("COMMIT");
    return {
      requested: eventIds.length > 0 ? eventIds.length : normalizedLimit,
      retried: result.rows.length,
      ids: result.rows.map((row) => row.id)
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
