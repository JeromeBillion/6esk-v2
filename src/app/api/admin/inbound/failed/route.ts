import { getSessionUser } from "@/server/auth/session";
import { isLeadAdmin } from "@/server/auth/roles";
import { db } from "@/server/db";
import { tenantScopeFromUser } from "@/server/tenant-context";

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!isLeadAdmin(user)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  const scope = tenantScopeFromUser(user);

  const url = new URL(request.url);
  const limitParam = url.searchParams.get("limit");
  const limit = Math.min(Math.max(Number(limitParam ?? 50) || 50, 1), 200);

  const result = await db.query(
    `SELECT id, idempotency_key, attempt_count, last_error, next_attempt_at, created_at
     FROM inbound_events
     WHERE status = 'failed'
       AND tenant_key = $2
     ORDER BY next_attempt_at ASC
     LIMIT $1`,
    [limit, scope.tenantKey]
  );

  return Response.json({ events: result.rows });
}
