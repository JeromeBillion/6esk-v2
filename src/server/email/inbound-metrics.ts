import { db } from "@/server/db";
import { getInboundAlertConfig } from "@/server/email/inbound-alert-config";

type NumericLike = number | string | null | undefined;

type InboundSummaryRow = {
  failed_queue: NumericLike;
  due_retry_now: NumericLike;
  processing_now: NumericLike;
  processed_window: NumericLike;
  failed_window: NumericLike;
  attempts_window: NumericLike;
  retry_processed_window: NumericLike;
  retry_failed_window: NumericLike;
  high_attempt_queue: NumericLike;
  max_failed_attempt_count: NumericLike;
  p95_failed_attempt_count: NumericLike;
  oldest_failed_at: string | Date | null;
};

type InboundSeriesRow = {
  hour: string | Date;
  failed: NumericLike;
  processed: NumericLike;
  processing: NumericLike;
  attempts: NumericLike;
};

type InboundAlertWindowRow = {
  failures: NumericLike;
};

type InboundAlertHistoryRow = {
  avg_bucket_failures: NumericLike;
  p95_bucket_failures: NumericLike;
  max_bucket_failures: NumericLike;
  bucket_count: NumericLike;
};

type InboundLastAlertRow = {
  last_sent_at: string | Date | null;
};

export type InboundHourlyPoint = {
  hour: string;
  failed: number;
  processed: number;
  processing: number;
  attempts: number;
};

type InboundAlertStatus = "below_threshold" | "cooldown" | "at_or_above_threshold";

export type InboundAlertRecommendation = {
  suggestedMinThreshold: number;
  suggestedMaxThreshold: number;
  inRange: boolean;
  reason: "insufficient_history" | "aligned" | "outside_range";
  avgBucketFailures: number;
  p95BucketFailures: number;
  maxBucketFailures: number;
  bucketCount: number;
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

function toPositiveInteger(value: number, fallback: number) {
  if (!Number.isFinite(value)) return fallback;
  const rounded = Math.trunc(value);
  return rounded > 0 ? rounded : fallback;
}

function minutesSince(value: string | Date | null | undefined, now = new Date()) {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  const delta = Math.floor((now.getTime() - parsed.getTime()) / 60000);
  return Math.max(0, delta);
}

export function buildInboundAlertThresholdRecommendation(input: {
  configuredThreshold: number;
  avgBucketFailures: number;
  p95BucketFailures: number;
  maxBucketFailures: number;
  bucketCount: number;
}): InboundAlertRecommendation {
  const configuredThreshold = toPositiveInteger(input.configuredThreshold, 1);
  const avgBucketFailures = Math.max(0, Number(input.avgBucketFailures || 0));
  const p95BucketFailures = Math.max(0, Number(input.p95BucketFailures || 0));
  const maxBucketFailures = Math.max(0, Number(input.maxBucketFailures || 0));
  const bucketCount = Math.max(0, Math.trunc(input.bucketCount || 0));

  if (bucketCount < 4) {
    return {
      suggestedMinThreshold: configuredThreshold,
      suggestedMaxThreshold: configuredThreshold,
      inRange: true,
      reason: "insufficient_history",
      avgBucketFailures,
      p95BucketFailures,
      maxBucketFailures,
      bucketCount
    };
  }

  const suggestedMinThreshold = Math.max(1, Math.ceil(avgBucketFailures));
  const suggestedMaxThreshold = Math.max(
    suggestedMinThreshold,
    Math.ceil(p95BucketFailures)
  );
  const inRange =
    configuredThreshold >= suggestedMinThreshold &&
    configuredThreshold <= suggestedMaxThreshold;

  return {
    suggestedMinThreshold,
    suggestedMaxThreshold,
    inRange,
    reason: inRange ? "aligned" : "outside_range",
    avgBucketFailures,
    p95BucketFailures,
    maxBucketFailures,
    bucketCount
  };
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
  const alertConfig = await getInboundAlertConfig();
  const alertWindowMinutes = toPositiveInteger(alertConfig.windowMinutes, 30);

  const [
    summaryResult,
    seriesResult,
    currentFailuresResult,
    alertHistoryResult,
    lastAlertResult
  ] = await Promise.all([
    db.query<InboundSummaryRow>(
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
         )::int AS attempts_window,
         COUNT(*) FILTER (
           WHERE status = 'processed'
             AND attempt_count > 0
             AND updated_at >= now() - ($1::int * interval '1 hour')
         )::int AS retry_processed_window,
         COUNT(*) FILTER (
           WHERE status = 'failed'
             AND attempt_count > 1
             AND updated_at >= now() - ($1::int * interval '1 hour')
         )::int AS retry_failed_window,
         COUNT(*) FILTER (WHERE status = 'failed' AND attempt_count >= 5)::int AS high_attempt_queue,
         COALESCE(MAX(attempt_count) FILTER (WHERE status = 'failed'), 0)::int AS max_failed_attempt_count,
         ROUND(
           COALESCE(
             (percentile_cont(0.95) WITHIN GROUP (ORDER BY attempt_count))
             FILTER (WHERE status = 'failed'),
             0
           )::numeric,
           2
         )::float8 AS p95_failed_attempt_count,
         MIN(created_at) FILTER (WHERE status = 'failed') AS oldest_failed_at
       FROM inbound_events`,
      [windowHours]
    ),
    db.query<InboundSeriesRow>(
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
    ),
    db.query<InboundAlertWindowRow>(
      `SELECT COUNT(*)::int AS failures
       FROM inbound_events
       WHERE status = 'failed'
         AND updated_at >= now() - ($1::text || ' minutes')::interval`,
      [alertWindowMinutes.toString()]
    ),
    db.query<InboundAlertHistoryRow>(
      `SELECT
         ROUND(COALESCE(AVG(bucket_failures), 0)::numeric, 2)::float8 AS avg_bucket_failures,
         ROUND(
           COALESCE(
             percentile_cont(0.95) WITHIN GROUP (ORDER BY bucket_failures),
             0
           )::numeric,
           2
         )::float8 AS p95_bucket_failures,
         COALESCE(MAX(bucket_failures), 0)::int AS max_bucket_failures,
         COUNT(*)::int AS bucket_count
       FROM (
         SELECT
           floor(extract(epoch FROM updated_at) / ($1::int * 60)) AS bucket_key,
           COUNT(*)::int AS bucket_failures
         FROM inbound_events
         WHERE status = 'failed'
           AND updated_at >= now() - interval '7 days'
         GROUP BY 1
       ) buckets`,
      [alertWindowMinutes]
    ),
    db.query<InboundLastAlertRow>(
      `SELECT last_sent_at
       FROM inbound_alerts
       WHERE alert_type = 'inbound_failures'
       LIMIT 1`
    )
  ]);

  const summary = summaryResult.rows[0] ?? {
    failed_queue: 0,
    due_retry_now: 0,
    processing_now: 0,
    processed_window: 0,
    failed_window: 0,
    attempts_window: 0,
    retry_processed_window: 0,
    retry_failed_window: 0,
    high_attempt_queue: 0,
    max_failed_attempt_count: 0,
    p95_failed_attempt_count: 0,
    oldest_failed_at: null
  };

  const now = new Date();
  const currentFailures = toNumber(currentFailuresResult.rows[0]?.failures);
  const configuredThreshold = toPositiveInteger(alertConfig.threshold, 5);
  const cooldownMinutes = toPositiveInteger(alertConfig.cooldownMinutes, 60);
  const lastSentAtRaw = lastAlertResult.rows[0]?.last_sent_at ?? null;
  const lastSentAtDate =
    lastSentAtRaw instanceof Date
      ? lastSentAtRaw
      : lastSentAtRaw
        ? new Date(lastSentAtRaw)
        : null;
  const cooldownRemainingMinutes = lastSentAtDate
    ? Math.max(0, cooldownMinutes - minutesSince(lastSentAtDate, now)!)
    : 0;

  let alertStatus: InboundAlertStatus =
    currentFailures >= configuredThreshold ? "at_or_above_threshold" : "below_threshold";
  if (alertStatus === "at_or_above_threshold" && cooldownRemainingMinutes > 0) {
    alertStatus = "cooldown";
  }

  const history = alertHistoryResult.rows[0] ?? {
    avg_bucket_failures: 0,
    p95_bucket_failures: 0,
    max_bucket_failures: 0,
    bucket_count: 0
  };
  const recommendation = buildInboundAlertThresholdRecommendation({
    configuredThreshold,
    avgBucketFailures: toNumber(history.avg_bucket_failures),
    p95BucketFailures: toNumber(history.p95_bucket_failures),
    maxBucketFailures: toNumber(history.max_bucket_failures),
    bucketCount: toNumber(history.bucket_count)
  });

  return {
    generatedAt: now.toISOString(),
    windowHours,
    summary: {
      failedQueue: toNumber(summary.failed_queue),
      dueRetryNow: toNumber(summary.due_retry_now),
      processingNow: toNumber(summary.processing_now),
      processedWindow: toNumber(summary.processed_window),
      failedWindow: toNumber(summary.failed_window),
      attemptsWindow: toNumber(summary.attempts_window),
      retryProcessedWindow: toNumber(summary.retry_processed_window),
      retryFailedWindow: toNumber(summary.retry_failed_window),
      highAttemptQueue: toNumber(summary.high_attempt_queue),
      maxFailedAttemptCount: toNumber(summary.max_failed_attempt_count),
      p95FailedAttemptCount: toNumber(summary.p95_failed_attempt_count),
      oldestFailedAgeMinutes: minutesSince(summary.oldest_failed_at, now)
    },
    alert: {
      source: alertConfig.source,
      webhookConfigured: Boolean(alertConfig.webhookUrl),
      threshold: configuredThreshold,
      windowMinutes: alertWindowMinutes,
      cooldownMinutes,
      currentFailures,
      status: alertStatus,
      cooldownRemainingMinutes,
      lastSentAt:
        lastSentAtDate && !Number.isNaN(lastSentAtDate.getTime())
          ? lastSentAtDate.toISOString()
          : null,
      wouldSendNow: alertStatus === "at_or_above_threshold" && Boolean(alertConfig.webhookUrl),
      recommendation
    },
    series: buildInboundHourlySeries(seriesResult.rows, windowHours, now)
  };
}
