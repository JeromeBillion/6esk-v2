import { getSessionUser } from "@/server/auth/session";
import { isLeadAdmin } from "@/server/auth/roles";
import { db } from "@/server/db";
import { redactCallData } from "@/server/calls/redaction";

type RejectionCountRow = {
  reason: string | null;
  mode: string | null;
  count: number | string | null;
};

type RecentRejectionRow = {
  id: string;
  created_at: Date;
  data: Record<string, unknown> | null;
};

function toNumber(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!isLeadAdmin(user)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(request.url);
  const hours = Math.min(Math.max(Number(url.searchParams.get("hours") ?? 24) || 24, 1), 168);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 50) || 50, 1), 200);

  const summaryResult = await db.query<RejectionCountRow>(
    `SELECT
       COALESCE(data->>'reason', 'unknown') AS reason,
       COALESCE(data->>'mode', 'unknown') AS mode,
       COUNT(*)::int AS count
     FROM audit_logs
     WHERE action = 'call_webhook_rejected'
       AND created_at >= now() - (($1::text || ' hours')::interval)
     GROUP BY 1, 2
     ORDER BY count DESC`,
    [hours]
  );

  const recentResult = await db.query<RecentRejectionRow>(
    `SELECT id, created_at, data
     FROM audit_logs
     WHERE action = 'call_webhook_rejected'
       AND created_at >= now() - (($1::text || ' hours')::interval)
     ORDER BY created_at DESC
     LIMIT $2`,
    [hours, limit]
  );

  return Response.json({
    windowHours: hours,
    summary: summaryResult.rows.map((row) => ({
      reason: row.reason ?? "unknown",
      mode: row.mode ?? "unknown",
      count: toNumber(row.count)
    })),
    recent: recentResult.rows.map((row) => ({
      id: row.id,
      createdAt: row.created_at.toISOString(),
      data: redactCallData(row.data ?? null)
    }))
  });
}
