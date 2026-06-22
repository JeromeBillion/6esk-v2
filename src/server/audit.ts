import { db } from "@/server/db";
import { redactCallData } from "@/server/calls/redaction";
import { DEFAULT_TENANT_ID } from "@/server/tenant/types";
import type { PoolClient, Pool } from "pg";

type AuditLogInput = {
  tenantId: string | null | undefined;
  actorUserId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  data?: Record<string, unknown> | null;
};

type PlatformAuditLogInput = Omit<AuditLogInput, "tenantId">;
type InsertAuditLogInput = Omit<AuditLogInput, "tenantId"> & { tenantId: string };
type AuditQueryClient = Pick<PoolClient | Pool, "query">;

function normalizeTenantId(tenantId: string | null | undefined) {
  const normalized = tenantId?.trim();
  return normalized || null;
}

function requireTenantId(tenantId: string | null | undefined, operation: string) {
  const normalized = normalizeTenantId(tenantId);
  if (!normalized) {
    throw new Error(`${operation} requires tenantId`);
  }
  return normalized;
}

async function insertAuditLog({
  tenantId,
  actorUserId,
  action,
  entityType,
  entityId,
  data
}: InsertAuditLogInput, client: AuditQueryClient = db) {
  await client.query(
    `INSERT INTO audit_logs (tenant_id, actor_user_id, action, entity_type, entity_id, data)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [tenantId, actorUserId ?? null, action, entityType, entityId ?? null, data ?? null]
  );
}

export async function recordAuditLog({
  tenantId,
  actorUserId,
  action,
  entityType,
  entityId,
  data
}: AuditLogInput) {
  await insertAuditLog({
    tenantId: requireTenantId(tenantId, "Record audit log"),
    actorUserId,
    action,
    entityType,
    entityId,
    data
  });
}

export async function recordAuditLogWithClient(
  client: AuditQueryClient,
  {
    tenantId,
    actorUserId,
    action,
    entityType,
    entityId,
    data
  }: AuditLogInput
) {
  await insertAuditLog(
    {
      tenantId: requireTenantId(tenantId, "Record audit log"),
      actorUserId,
      action,
      entityType,
      entityId,
      data
    },
    client
  );
}

export async function recordPlatformAuditLog({
  actorUserId,
  action,
  entityType,
  entityId,
  data
}: PlatformAuditLogInput) {
  await insertAuditLog({
    tenantId: DEFAULT_TENANT_ID,
    actorUserId,
    action,
    entityType,
    entityId,
    data: {
      ...(data ?? {}),
      platformAudit: true
    }
  });
}

export async function listAuditLogsForTicket(
  ticketId: string,
  tenantId: string | null | undefined,
  limit = 50
) {
  const effectiveTenantId = requireTenantId(tenantId, "List ticket audit logs");
  const result = await db.query(
    `SELECT a.id, a.action, a.entity_type, a.entity_id, a.data, a.created_at,
            u.display_name as actor_name, u.email as actor_email
     FROM audit_logs a
     LEFT JOIN users u ON u.id = a.actor_user_id AND u.tenant_id = a.tenant_id
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
