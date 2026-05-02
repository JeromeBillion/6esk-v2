import { db } from "@/server/db";
import { redactCallData } from "@/server/calls/redaction";
import { DEFAULT_TENANT_ID } from "@/server/tenant/types";

/**
 * Record an audit log entry.
 *
 * In v2, tenantId is required for proper isolation. During the migration
 * period, callers that haven't been updated yet can omit it and the
 * default tenant will be used.
 */
export async function recordAuditLog({
  tenantId,
  actorUserId,
  action,
  entityType,
  entityId,
  data
}: {
  tenantId?: string | null;
  actorUserId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  data?: Record<string, unknown> | null;
}) {
  const effectiveTenantId = tenantId ?? DEFAULT_TENANT_ID;
  await db.query(
    `INSERT INTO audit_logs (tenant_id, actor_user_id, action, entity_type, entity_id, data)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [effectiveTenantId, actorUserId ?? null, action, entityType, entityId ?? null, data ?? null]
  );
}

export async function listAuditLogsForTicket(ticketId: string, tenantId?: string | null, limit = 50) {
  const effectiveTenantId = tenantId ?? DEFAULT_TENANT_ID;
  const result = await db.query(
    `SELECT a.id, a.action, a.entity_type, a.entity_id, a.data, a.created_at,
            u.display_name as actor_name, u.email as actor_email
     FROM audit_logs a
     LEFT JOIN users u ON u.id = a.actor_user_id
     WHERE a.tenant_id = $1
       AND (a.entity_id = $2 OR (a.data->>'ticketId') = $2::text)
     ORDER BY a.created_at DESC
     LIMIT $3`,
    [effectiveTenantId, ticketId, limit]
  );
  return result.rows.map((row) => ({
    ...row,
    data: redactCallData(row.data ?? null)
  }));
}
