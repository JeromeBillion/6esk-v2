import { getSessionUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { getDateRange } from "@/server/analytics/dateRange";

type GroupBy = "agent" | "tag" | "priority";

const isGroupBy = (value: string | null): value is GroupBy =>
  value === "agent" || value === "tag" || value === "priority";

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const groupByParam = url.searchParams.get("groupBy");
  const groupBy: GroupBy = isGroupBy(groupByParam) ? groupByParam : "agent";
  const { start, end } = getDateRange(url.searchParams);

  const agentId = url.searchParams.get("agentId");
  const priority = url.searchParams.get("priority");
  const tag = url.searchParams.get("tag");

  const values: Array<string | Date> = [start, end];
  const conditions: string[] = ["t.created_at >= $1", "t.created_at < $2"];

  if (agentId) {
    values.push(agentId);
    conditions.push(`t.assigned_user_id = $${values.length}`);
  }

  if (priority) {
    values.push(priority);
    conditions.push(`t.priority = $${values.length}`);
  }

  const shouldJoinTags = groupBy === "tag" || Boolean(tag);
  let tagFilterClause = "";
  if (tag) {
    values.push(tag.toLowerCase());
    tagFilterClause = `AND tag.name = $${values.length}`;
  }

  let query = "";
  if (groupBy === "agent") {
    query = `
      SELECT
        u.id AS key,
        COALESCE(u.display_name, u.email) AS label,
        COUNT(t.id)::int AS total,
        COUNT(*) FILTER (WHERE t.status NOT IN ('solved', 'closed'))::int AS open,
        COUNT(*) FILTER (WHERE t.status IN ('solved', 'closed'))::int AS solved,
        AVG(EXTRACT(EPOCH FROM (r.first_response - t.created_at))) AS avg_first_response_seconds,
        AVG(EXTRACT(EPOCH FROM (t.solved_at - t.created_at))) AS avg_resolution_seconds
      FROM tickets t
      JOIN users u ON u.id = t.assigned_user_id
      ${shouldJoinTags ? "LEFT JOIN ticket_tags tt ON tt.ticket_id = t.id LEFT JOIN tags tag ON tag.id = tt.tag_id" : ""}
      LEFT JOIN LATERAL (
        SELECT MIN(sent_at) AS first_response
        FROM messages m
        WHERE m.ticket_id = t.id
          AND m.direction = 'outbound'
          AND m.sent_at IS NOT NULL
      ) r ON true
      WHERE ${conditions.join(" AND ")}
      ${tagFilterClause}
      GROUP BY u.id, u.display_name, u.email
      ORDER BY total DESC
    `;
  }

  if (groupBy === "tag") {
    query = `
      SELECT
        tag.name AS key,
        tag.name AS label,
        COUNT(DISTINCT t.id)::int AS total,
        COUNT(DISTINCT t.id) FILTER (WHERE t.status NOT IN ('solved', 'closed'))::int AS open,
        COUNT(DISTINCT t.id) FILTER (WHERE t.status IN ('solved', 'closed'))::int AS solved,
        AVG(EXTRACT(EPOCH FROM (r.first_response - t.created_at))) AS avg_first_response_seconds,
        AVG(EXTRACT(EPOCH FROM (t.solved_at - t.created_at))) AS avg_resolution_seconds
      FROM tickets t
      JOIN ticket_tags tt ON tt.ticket_id = t.id
      JOIN tags tag ON tag.id = tt.tag_id
      LEFT JOIN LATERAL (
        SELECT MIN(sent_at) AS first_response
        FROM messages m
        WHERE m.ticket_id = t.id
          AND m.direction = 'outbound'
          AND m.sent_at IS NOT NULL
      ) r ON true
      WHERE ${conditions.join(" AND ")}
      ${tagFilterClause}
      GROUP BY tag.name
      ORDER BY total DESC
    `;
  }

  if (groupBy === "priority") {
    query = `
      SELECT
        t.priority AS key,
        t.priority AS label,
        COUNT(t.id)::int AS total,
        COUNT(*) FILTER (WHERE t.status NOT IN ('solved', 'closed'))::int AS open,
        COUNT(*) FILTER (WHERE t.status IN ('solved', 'closed'))::int AS solved,
        AVG(EXTRACT(EPOCH FROM (r.first_response - t.created_at))) AS avg_first_response_seconds,
        AVG(EXTRACT(EPOCH FROM (t.solved_at - t.created_at))) AS avg_resolution_seconds
      FROM tickets t
      ${shouldJoinTags ? "LEFT JOIN ticket_tags tt ON tt.ticket_id = t.id LEFT JOIN tags tag ON tag.id = tt.tag_id" : ""}
      LEFT JOIN LATERAL (
        SELECT MIN(sent_at) AS first_response
        FROM messages m
        WHERE m.ticket_id = t.id
          AND m.direction = 'outbound'
          AND m.sent_at IS NOT NULL
      ) r ON true
      WHERE ${conditions.join(" AND ")}
      ${tagFilterClause}
      GROUP BY t.priority
      ORDER BY total DESC
    `;
  }

  const result = await db.query(query, values);

  return Response.json({
    range: { start: start.toISOString(), end: end.toISOString() },
    groupBy,
    rows: result.rows
  });
}
