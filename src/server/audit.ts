import { db } from "@/server/db";
import { redactCallData } from "@/server/calls/redaction";

export async function recordAuditLog({
  actorUserId,
  action,
  entityType,
  entityId,
  data
}: {
  actorUserId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  data?: Record<string, unknown> | null;
}) {
  await db.query(
    `INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, data)
     VALUES ($1, $2, $3, $4, $5)`,
    [actorUserId ?? null, action, entityType, entityId ?? null, data ?? null]
  );
}

export async function listAuditLogsForTicket(ticketId: string, limit = 50) {
  const result = await db.query(
    `SELECT a.id, a.action, a.entity_type, a.entity_id, a.data, a.created_at,
            u.display_name as actor_name, u.email as actor_email
     FROM audit_logs a
     LEFT JOIN users u ON u.id = a.actor_user_id
     WHERE a.entity_id = $1 OR (a.data->>'ticketId') = $1
     ORDER BY a.created_at DESC
     LIMIT $2`,
    [ticketId, limit]
  );
  return result.rows.map((row) => ({
    ...row,
    data: redactCallData(row.data ?? null)
  }));
}
