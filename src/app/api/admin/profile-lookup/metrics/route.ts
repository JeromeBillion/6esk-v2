import { getSessionUser } from "@/server/auth/session";
import { isLeadAdmin } from "@/server/auth/roles";
import { db } from "@/server/db";

type LookupSummaryRow = {
  total: number;
  matched: number;
  missed: number;
  errored: number;
  disabled: number;
  timeout_errors: number;
  avg_duration_ms: number | null;
  p95_duration_ms: number | null;
};

type LookupSeriesRow = {
  day: string;
  matched: number;
  missed: number;
  errored: number;
  disabled: number;
};

function parseWindowDays(value: string | null) {
  const parsed = Number(value ?? 14);
  if (!Number.isFinite(parsed)) return 14;
  const rounded = Math.round(parsed);
  return Math.min(Math.max(rounded, 1), 90);
}

function parseTimeoutMs(value: string | undefined) {
  const parsed = Number.parseInt(value ?? "1500", 10);
  if (!Number.isFinite(parsed)) return 1500;
  return Math.min(Math.max(parsed, 200), 10000);
}

function toPercent(numerator: number, denominator: number) {
  if (!denominator) return 0;
  return Number(((numerator / denominator) * 100).toFixed(2));
}

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!isLeadAdmin(user)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(request.url);
  const windowDays = parseWindowDays(url.searchParams.get("days"));

  const scopedCte = `
    WITH scoped AS (
      SELECT
        COALESCE(
          CASE
            WHEN (t.metadata->'profile_lookup'->>'lookupAt') ~ '^[0-9]{4}-'
              THEN (t.metadata->'profile_lookup'->>'lookupAt')::timestamptz
            ELSE NULL
          END,
          t.updated_at,
          t.created_at
        ) AS lookup_at,
        COALESCE(NULLIF(t.metadata->'profile_lookup'->>'status', ''), 'unknown') AS status,
        LOWER(COALESCE(t.metadata->'profile_lookup'->>'error', '')) AS error_text,
        CASE
          WHEN (t.metadata->'profile_lookup'->>'durationMs') ~ '^[0-9]+(\\.[0-9]+)?$'
            THEN (t.metadata->'profile_lookup'->>'durationMs')::double precision
          ELSE NULL
        END AS duration_ms
      FROM tickets t
      WHERE t.metadata ? 'profile_lookup'
    )`;

  const [summaryResult, seriesResult] = await Promise.all([
    db.query<LookupSummaryRow>(
      `${scopedCte}
       SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE status = 'matched')::int AS matched,
         COUNT(*) FILTER (WHERE status = 'missed')::int AS missed,
         COUNT(*) FILTER (WHERE status = 'error')::int AS errored,
         COUNT(*) FILTER (WHERE status = 'disabled')::int AS disabled,
         COUNT(*) FILTER (
           WHERE status = 'error'
             AND error_text LIKE '%timeout%'
         )::int AS timeout_errors,
         ROUND(AVG(duration_ms)::numeric, 2)::float8 AS avg_duration_ms,
         ROUND(
           (percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms))
           FILTER (WHERE duration_ms IS NOT NULL)::numeric,
           2
         )::float8 AS p95_duration_ms
       FROM scoped
       WHERE lookup_at >= now() - make_interval(days => $1::int)`,
      [windowDays]
    ),
    db.query<LookupSeriesRow>(
      `${scopedCte}
       SELECT
         to_char(date_trunc('day', lookup_at), 'YYYY-MM-DD') AS day,
         COUNT(*) FILTER (WHERE status = 'matched')::int AS matched,
         COUNT(*) FILTER (WHERE status = 'missed')::int AS missed,
         COUNT(*) FILTER (WHERE status = 'error')::int AS errored,
         COUNT(*) FILTER (WHERE status = 'disabled')::int AS disabled
       FROM scoped
       WHERE lookup_at >= now() - make_interval(days => $1::int)
       GROUP BY 1
       ORDER BY 1 ASC`,
      [windowDays]
    )
  ]);

  const summary = summaryResult.rows[0] ?? {
    total: 0,
    matched: 0,
    missed: 0,
    errored: 0,
    disabled: 0,
    timeout_errors: 0,
    avg_duration_ms: null,
    p95_duration_ms: null
  };

  return Response.json({
    generatedAt: new Date().toISOString(),
    windowDays,
    configuredTimeoutMs: parseTimeoutMs(process.env.PREDICTION_PROFILE_LOOKUP_TIMEOUT_MS),
    summary: {
      total: summary.total,
      matched: summary.matched,
      missed: summary.missed,
      errored: summary.errored,
      disabled: summary.disabled,
      timeoutErrors: summary.timeout_errors,
      hitRate: toPercent(summary.matched, summary.total),
      missRate: toPercent(summary.missed, summary.total),
      errorRate: toPercent(summary.errored, summary.total),
      timeoutErrorRate: toPercent(summary.timeout_errors, summary.total),
      avgDurationMs: summary.avg_duration_ms,
      p95DurationMs: summary.p95_duration_ms
    },
    series: seriesResult.rows
  });
}

