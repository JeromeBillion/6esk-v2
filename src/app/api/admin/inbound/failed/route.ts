import { getSessionUser } from "@/server/auth/session";
import { isLeadAdmin } from "@/server/auth/roles";
import { sessionTenantId } from "@/server/auth/tenant-session";
import { db } from "@/server/db";

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!isLeadAdmin(user)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const tenantId = sessionTenantId(user);
  if (!tenantId) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(request.url);
  const limitParam = url.searchParams.get("limit");
  const limit = Math.min(Math.max(Number(limitParam ?? 50) || 50, 1), 200);

  const result = await db.query(
    `SELECT id, idempotency_key, attempt_count, last_error, next_attempt_at, created_at
     FROM inbound_events
     WHERE status = 'failed'
       AND tenant_id = $1
     ORDER BY next_attempt_at ASC
     LIMIT $2`,
    [tenantId, limit]
  );

  return Response.json({ events: result.rows });
}
