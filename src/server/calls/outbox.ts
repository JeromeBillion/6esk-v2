import { db } from "@/server/db";
import { updateCallSessionStatus } from "@/server/calls/service";

type CallOutboxEventRow = {
  id: string;
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
  processingRecoverySeconds: number
): Promise<CallOutboxEventRow[]> {
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
       RETURNING id, payload, attempt_count`,
      [limit, processingRecoverySeconds]
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
  callSessionId,
  provider,
  providerCallId
}: {
  eventId: string;
  callSessionId: string | null;
  provider: string;
  providerCallId: string | null;
}) {
  await db.query(
    `UPDATE call_outbox_events
     SET status = 'sent',
         updated_at = now()
     WHERE id = $1`,
    [eventId]
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
  attemptCount,
  errorMessage,
  callSessionId
}: {
  eventId: string;
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
     WHERE id = $5`,
    [status, attemptCount, errorMessage.slice(0, 500), nextAttempt, eventId]
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

async function sendOutboundCall(
  provider: string,
  eventId: string,
  payload: Record<string, unknown>
): Promise<{ providerCallId: string | null }> {
  if (provider === "mock") {
    return { providerCallId: `mock-${eventId}` };
  }

  throw new Error(`Call provider '${provider}' is not configured.`);
}

export async function deliverPendingCallEvents({ limit = 5 }: DeliverCallOutboxArgs = {}) {
  const provider = getCallProvider();
  const pending = await lockPendingEvents(limit, getProcessingRecoverySeconds());
  if (!pending.length) {
    return { delivered: 0, skipped: 0, provider };
  }

  let delivered = 0;
  for (const event of pending) {
    const payload = event.payload ?? {};
    const callSessionId =
      typeof payload.callSessionId === "string" ? payload.callSessionId : null;
    try {
      const { providerCallId } = await sendOutboundCall(provider, event.id, payload);
      await markDelivered({
        eventId: event.id,
        callSessionId,
        provider,
        providerCallId
      });
      delivered += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Call delivery failed";
      await markFailed({
        eventId: event.id,
        attemptCount: event.attempt_count + 1,
        errorMessage: message,
        callSessionId
      });
    }
  }

  return { delivered, skipped: pending.length - delivered, provider };
}

export async function getCallOutboxMetrics() {
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
     WHERE direction = 'outbound'`
  );

  const errorResult = await db.query<CallOutboxErrorRow>(
    `SELECT last_error
     FROM call_outbox_events
     WHERE direction = 'outbound'
       AND status = 'failed'
       AND last_error IS NOT NULL
     ORDER BY updated_at DESC
     LIMIT 1`
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

export async function listFailedCallOutboxEvents(limit = 50) {
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
       AND status = 'failed'
     ORDER BY updated_at DESC
     LIMIT $1`,
    [normalizedLimit]
  );
  return result.rows;
}

type RetryFailedCallOutboxInput = {
  limit?: number;
  eventIds?: string[];
};

export async function retryFailedCallOutboxEvents(input: RetryFailedCallOutboxInput = {}) {
  const normalizedLimit = Math.min(Math.max(input.limit ?? 25, 1), 100);
  const eventIds = Array.from(
    new Set((input.eventIds ?? []).map((value) => value.trim()).filter(Boolean))
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
               AND id::text = ANY($1::text[])
             RETURNING id`,
            [eventIds]
          )
        : await client.query<{ id: string }>(
            `WITH failed AS (
               SELECT id
               FROM call_outbox_events
               WHERE direction = 'outbound'
                 AND status = 'failed'
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
             RETURNING evt.id`,
            [normalizedLimit]
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
