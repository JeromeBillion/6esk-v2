import { getSessionUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { getDateRange } from "@/server/analytics/dateRange";
import {
  buildWhatsAppStatusSeries,
  parseWhatsAppStatusSource,
  type WhatsAppStatusSource,
  type WhatsAppStatusAggregateRow
} from "@/server/analytics/whatsapp-series";

type VolumeRow = {
  day: Date;
  count: number;
};

type VoiceVolumeRow = {
  day: Date;
  inbound: number | string | null;
  outbound: number | string | null;
  completed: number | string | null;
  failed: number | string | null;
  no_answer: number | string | null;
  busy: number | string | null;
  canceled: number | string | null;
  avg_duration_seconds: number | string | null;
};

function toInt(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const { start, end } = getDateRange(url.searchParams);
  const whatsappSource: WhatsAppStatusSource = parseWhatsAppStatusSource(
    url.searchParams.get("whatsappSource")
  );

  const createdResult = await db.query<VolumeRow>(
    `SELECT date_trunc('day', created_at) AS day, COUNT(*)::int AS count
     FROM tickets
     WHERE created_at >= $1 AND created_at < $2
     GROUP BY day
     ORDER BY day`,
    [start, end]
  );

  const solvedResult = await db.query<VolumeRow>(
    `SELECT date_trunc('day', solved_at) AS day, COUNT(*)::int AS count
     FROM tickets
     WHERE solved_at IS NOT NULL
       AND solved_at >= $1 AND solved_at < $2
     GROUP BY day
     ORDER BY day`,
    [start, end]
  );

  const whatsappStatusResult = await db.query<WhatsAppStatusAggregateRow>(
    `SELECT
       date_trunc('day', occurred_at) AS day,
       COUNT(*) FILTER (WHERE status = 'sent')::int AS sent,
       COUNT(*) FILTER (WHERE status = 'delivered')::int AS delivered,
       COUNT(*) FILTER (WHERE status = 'read')::int AS read,
       COUNT(*) FILTER (WHERE status = 'failed')::int AS failed
     FROM whatsapp_status_events
     WHERE occurred_at >= $1 AND occurred_at < $2
       AND ($3 = 'all' OR COALESCE(payload->>'source', 'unknown') = $3)
     GROUP BY day
     ORDER BY day`,
    [start, end, whatsappSource]
  );

  const voiceResult = await db.query<VoiceVolumeRow>(
    `SELECT
       date_trunc('day', queued_at) AS day,
       COUNT(*) FILTER (WHERE direction = 'inbound')::int AS inbound,
       COUNT(*) FILTER (WHERE direction = 'outbound')::int AS outbound,
       COUNT(*) FILTER (WHERE status = 'completed')::int AS completed,
       COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
       COUNT(*) FILTER (WHERE status = 'no_answer')::int AS no_answer,
       COUNT(*) FILTER (WHERE status = 'busy')::int AS busy,
       COUNT(*) FILTER (WHERE status = 'canceled')::int AS canceled,
       AVG(duration_seconds)::numeric AS avg_duration_seconds
     FROM call_sessions
     WHERE queued_at >= $1 AND queued_at < $2
     GROUP BY day
     ORDER BY day`,
    [start, end]
  );

  const formatRows = (rows: VolumeRow[]) =>
    rows.map((row) => ({
      day: row.day.toISOString(),
      count: row.count
    }));

  return Response.json({
    range: { start: start.toISOString(), end: end.toISOString() },
    created: formatRows(createdResult.rows),
    solved: formatRows(solvedResult.rows),
    voice: voiceResult.rows.map((row) => ({
      day: row.day.toISOString(),
      inbound: toInt(row.inbound),
      outbound: toInt(row.outbound),
      completed: toInt(row.completed),
      failed: toInt(row.failed),
      noAnswer: toInt(row.no_answer),
      busy: toInt(row.busy),
      canceled: toInt(row.canceled),
      avgDurationSeconds: Number(row.avg_duration_seconds ?? 0)
    })),
    whatsappSource,
    whatsapp: buildWhatsAppStatusSeries(whatsappStatusResult.rows)
  });
}
