import { db } from "@/server/db";
import { redactCallData } from "@/server/calls/redaction";
import { resolveTenantScope, type TenantScopeInput } from "@/server/tenant-context";

export async function recordAuditLog({
  tenantKey,
  workspaceKey,
  actorUserId,
  action,
  entityType,
  entityId,
  data
}: {
  tenantKey?: string | null;
  workspaceKey?: string | null;
  actorUserId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  data?: Record<string, unknown> | null;
}) {
  const scope = resolveTenantScope({ tenantKey, workspaceKey });
  await db.query(
    `INSERT INTO audit_logs (tenant_key, workspace_key, actor_user_id, action, entity_type, entity_id, data)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [scope.tenantKey, scope.workspaceKey, actorUserId ?? null, action, entityType, entityId ?? null, data ?? null]
  );
}

export async function listAuditLogsForTicket(
  ticketId: string,
  limit = 50,
  scopeInput?: TenantScopeInput
) {
  const { tenantKey } = resolveTenantScope(scopeInput);
  const result = await db.query(
    `SELECT a.id, a.action, a.entity_type, a.entity_id, a.data, a.created_at,
            u.display_name as actor_name, u.email as actor_email
     FROM audit_logs a
     LEFT JOIN users u ON u.id = a.actor_user_id AND u.tenant_key = a.tenant_key
     WHERE a.tenant_key = $1
       AND (a.entity_id = $2 OR (a.data->>'ticketId') = $2::text)
     ORDER BY a.created_at DESC
     LIMIT $3`,
    [tenantKey, ticketId, limit]
  );
  return result.rows.map((row) => ({
    ...row,
    data: redactCallData(row.data ?? null)
  }));
}
