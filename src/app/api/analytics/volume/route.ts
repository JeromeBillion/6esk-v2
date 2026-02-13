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

  const formatRows = (rows: VolumeRow[]) =>
    rows.map((row) => ({
      day: row.day.toISOString(),
      count: row.count
    }));

  return Response.json({
    range: { start: start.toISOString(), end: end.toISOString() },
    created: formatRows(createdResult.rows),
    solved: formatRows(solvedResult.rows),
    whatsappSource,
    whatsapp: buildWhatsAppStatusSeries(whatsappStatusResult.rows)
  });
}
