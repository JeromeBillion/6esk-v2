import { getSessionUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { getDateRange, getTodayRangeUtc } from "@/server/analytics/dateRange";

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const { start, end } = getDateRange(url.searchParams);
  const today = getTodayRangeUtc();

  const totalTicketsResult = await db.query(
    `SELECT COUNT(*)::int AS count
     FROM tickets
     WHERE created_at >= $1 AND created_at < $2`,
    [start, end]
  );

  const openTicketsResult = await db.query(
    `SELECT COUNT(*)::int AS count
     FROM tickets
     WHERE status NOT IN ('solved', 'closed')`
  );

  const createdTodayResult = await db.query(
    `SELECT COUNT(*)::int AS count
     FROM tickets
     WHERE created_at >= $1 AND created_at < $2`,
    [today.start, today.end]
  );

  const solvedTodayResult = await db.query(
    `SELECT COUNT(*)::int AS count
     FROM tickets
     WHERE solved_at >= $1 AND solved_at < $2`,
    [today.start, today.end]
  );

  const firstResponseResult = await db.query(
    `SELECT AVG(EXTRACT(EPOCH FROM (r.first_response - t.created_at))) AS avg_seconds
     FROM tickets t
     JOIN LATERAL (
       SELECT MIN(sent_at) AS first_response
       FROM messages m
       WHERE m.ticket_id = t.id
         AND m.direction = 'outbound'
         AND m.sent_at IS NOT NULL
     ) r ON true
     WHERE t.created_at >= $1 AND t.created_at < $2
       AND r.first_response IS NOT NULL`,
    [start, end]
  );

  const resolutionResult = await db.query(
    `SELECT AVG(EXTRACT(EPOCH FROM (t.solved_at - t.created_at))) AS avg_seconds
     FROM tickets t
     WHERE t.solved_at IS NOT NULL
       AND t.solved_at >= $1 AND t.solved_at < $2`,
    [start, end]
  );

  return Response.json({
    range: { start: start.toISOString(), end: end.toISOString() },
    totalTickets: totalTicketsResult.rows[0]?.count ?? 0,
    openTickets: openTicketsResult.rows[0]?.count ?? 0,
    ticketsCreatedToday: createdTodayResult.rows[0]?.count ?? 0,
    ticketsSolvedToday: solvedTodayResult.rows[0]?.count ?? 0,
    avgFirstResponseSeconds: Number(firstResponseResult.rows[0]?.avg_seconds ?? 0),
    avgResolutionSeconds: Number(resolutionResult.rows[0]?.avg_seconds ?? 0)
  });
}
