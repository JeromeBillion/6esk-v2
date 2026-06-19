import { getSessionUser } from "@/server/auth/session";
import { sessionTenantId } from "@/server/auth/tenant-session";
import { db } from "@/server/db";
import { getDateRange } from "@/server/analytics/dateRange";

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = sessionTenantId(user);
  if (!tenantId) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(request.url);
  const { start, end } = getDateRange(url.searchParams);

  const slaResult = await db.query(
    `SELECT first_response_target_minutes, resolution_target_minutes
     FROM sla_configs
     WHERE tenant_id = $1
       AND is_active = true
     ORDER BY created_at DESC
     LIMIT 1`,
    [tenantId]
  );

  const sla = slaResult.rows[0] ?? {
    first_response_target_minutes: 120,
    resolution_target_minutes: 1440
  };

  const firstResponseResult = await db.query(
    `SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (
          WHERE EXTRACT(EPOCH FROM (r.first_response - t.created_at)) <= ($3 * 60)
        )::int AS compliant
     FROM tickets t
     JOIN LATERAL (
       SELECT MIN(sent_at) AS first_response
       FROM messages m
       WHERE m.ticket_id = t.id
         AND m.tenant_id = t.tenant_id
         AND m.direction = 'outbound'
         AND m.sent_at IS NOT NULL
     ) r ON true
     WHERE t.created_at >= $1 AND t.created_at < $2
       AND t.tenant_id = $4
       AND r.first_response IS NOT NULL`,
    [start, end, sla.first_response_target_minutes, tenantId]
  );

  const resolutionResult = await db.query(
    `SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (
          WHERE EXTRACT(EPOCH FROM (t.solved_at - t.created_at)) <= ($3 * 60)
        )::int AS compliant
     FROM tickets t
     WHERE t.solved_at IS NOT NULL
       AND t.solved_at >= $1 AND t.solved_at < $2
       AND t.tenant_id = $4`,
    [start, end, sla.resolution_target_minutes, tenantId]
  );

  const firstResponseTotal = firstResponseResult.rows[0]?.total ?? 0;
  const firstResponseCompliant = firstResponseResult.rows[0]?.compliant ?? 0;
  const resolutionTotal = resolutionResult.rows[0]?.total ?? 0;
  const resolutionCompliant = resolutionResult.rows[0]?.compliant ?? 0;

  return Response.json({
    range: { start: start.toISOString(), end: end.toISOString() },
    targets: {
      firstResponseMinutes: sla.first_response_target_minutes,
      resolutionMinutes: sla.resolution_target_minutes
    },
    firstResponse: {
      total: firstResponseTotal,
      compliant: firstResponseCompliant,
      complianceRate:
        firstResponseTotal === 0 ? 0 : firstResponseCompliant / firstResponseTotal
    },
    resolution: {
      total: resolutionTotal,
      compliant: resolutionCompliant,
      complianceRate: resolutionTotal === 0 ? 0 : resolutionCompliant / resolutionTotal
    }
  });
}
