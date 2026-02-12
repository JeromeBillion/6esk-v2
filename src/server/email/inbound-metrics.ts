import { db } from "@/server/db";

type NumericLike = number | string | null | undefined;

type InboundSummaryRow = {
  failed_queue: NumericLike;
  due_retry_now: NumericLike;
  processing_now: NumericLike;
  processed_window: NumericLike;
  failed_window: NumericLike;
  attempts_window: NumericLike;
};

type InboundSeriesRow = {
  hour: string | Date;
  failed: NumericLike;
  processed: NumericLike;
  processing: NumericLike;
  attempts: NumericLike;
};

export type InboundHourlyPoint = {
  hour: string;
  failed: number;
  processed: number;
  processing: number;
  attempts: number;
};

function toNumber(value: NumericLike) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function clampHours(hours: number) {
  const parsed = Number.isFinite(hours) ? Math.trunc(hours) : 24;
  return Math.min(Math.max(parsed, 6), 72);
}

function normalizeHour(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  date.setUTCMinutes(0, 0, 0);
  return date.toISOString();
}

export function buildInboundHourlySeries(
  rows: InboundSeriesRow[],
  hours = 24,
  now = new Date()
): InboundHourlyPoint[] {
  const safeHours = clampHours(hours);
  const byHour = new Map<string, InboundHourlyPoint>();

  for (const row of rows) {
    const key = normalizeHour(row.hour);
    byHour.set(key, {
      hour: key,
      failed: toNumber(row.failed),
      processed: toNumber(row.processed),
      processing: toNumber(row.processing),
      attempts: toNumber(row.attempts)
    });
  }

  const end = new Date(now);
  end.setUTCMinutes(0, 0, 0);
  const points: InboundHourlyPoint[] = [];

  for (let offset = safeHours - 1; offset >= 0; offset -= 1) {
    const bucket = new Date(end);
    bucket.setUTCHours(end.getUTCHours() - offset);
    const key = bucket.toISOString();
    points.push(
      byHour.get(key) ?? {
        hour: key,
        failed: 0,
        processed: 0,
        processing: 0,
        attempts: 0
      }
    );
  }

  return points;
}

export async function getInboundMetrics(hours = 24) {
  const windowHours = clampHours(hours);

  const summaryResult = await db.query<InboundSummaryRow>(
    `SELECT
       COUNT(*) FILTER (WHERE status = 'failed')::int AS failed_queue,
       COUNT(*) FILTER (WHERE status = 'failed' AND next_attempt_at <= now())::int AS due_retry_now,
       COUNT(*) FILTER (WHERE status = 'processing')::int AS processing_now,
       COUNT(*) FILTER (
         WHERE status = 'processed'
           AND updated_at >= now() - ($1::int * interval '1 hour')
       )::int AS processed_window,
       COUNT(*) FILTER (
         WHERE status = 'failed'
           AND updated_at >= now() - ($1::int * interval '1 hour')
       )::int AS failed_window,
       COALESCE(
         SUM(attempt_count) FILTER (WHERE updated_at >= now() - ($1::int * interval '1 hour')),
         0
       )::int AS attempts_window
     FROM inbound_events`,
    [windowHours]
  );

  const seriesResult = await db.query<InboundSeriesRow>(
    `SELECT
       date_trunc('hour', updated_at) AS hour,
       COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
       COUNT(*) FILTER (WHERE status = 'processed')::int AS processed,
       COUNT(*) FILTER (WHERE status = 'processing')::int AS processing,
       COALESCE(SUM(attempt_count), 0)::int AS attempts
     FROM inbound_events
     WHERE updated_at >= now() - ($1::int * interval '1 hour')
     GROUP BY 1
     ORDER BY 1 ASC`,
    [windowHours]
  );

  const summary = summaryResult.rows[0] ?? {
    failed_queue: 0,
    due_retry_now: 0,
    processing_now: 0,
    processed_window: 0,
    failed_window: 0,
    attempts_window: 0
  };

  return {
    generatedAt: new Date().toISOString(),
    windowHours,
    summary: {
      failedQueue: toNumber(summary.failed_queue),
      dueRetryNow: toNumber(summary.due_retry_now),
      processingNow: toNumber(summary.processing_now),
      processedWindow: toNumber(summary.processed_window),
      failedWindow: toNumber(summary.failed_window),
      attemptsWindow: toNumber(summary.attempts_window)
    },
    series: buildInboundHourlySeries(seriesResult.rows, windowHours)
  };
}
