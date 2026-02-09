import { getSessionUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { getDateRange } from "@/server/analytics/dateRange";

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const { start, end } = getDateRange(url.searchParams);

  const createdResult = await db.query(
    `SELECT date_trunc('day', created_at) AS day, COUNT(*)::int AS count
     FROM tickets
     WHERE created_at >= $1 AND created_at < $2
     GROUP BY day
     ORDER BY day`,
    [start, end]
  );

  const solvedResult = await db.query(
    `SELECT date_trunc('day', solved_at) AS day, COUNT(*)::int AS count
     FROM tickets
     WHERE solved_at IS NOT NULL
       AND solved_at >= $1 AND solved_at < $2
     GROUP BY day
     ORDER BY day`,
    [start, end]
  );

  const formatRows = (rows: { day: Date; count: number }[]) =>
    rows.map((row) => ({
      day: row.day.toISOString(),
      count: row.count
    }));

  return Response.json({
    range: { start: start.toISOString(), end: end.toISOString() },
    created: formatRows(createdResult.rows),
    solved: formatRows(solvedResult.rows)
  });
}
