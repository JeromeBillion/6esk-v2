import { requireLeadAdminAccess } from "@/server/auth/admin-guard";
import { db } from "@/server/db";

export async function GET(request: Request) {
  const access = await requireLeadAdminAccess();
  if (!access.ok) return access.response;
  const { scope } = access;

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
