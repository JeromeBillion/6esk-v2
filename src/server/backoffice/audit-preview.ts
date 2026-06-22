import { db } from "@/server/db";

export type BackofficeAuditPreview = {
  id: string;
  tenantId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  actorEmail: string | null;
  createdAt: string;
};

type AuditPreviewRow = {
  id: string;
  tenant_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  actor_email: string | null;
  created_at: string;
};

function mapAuditPreview(row: AuditPreviewRow): BackofficeAuditPreview {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    actorEmail: row.actor_email,
    createdAt: row.created_at
  };
}

export async function listBackofficeAuditPreview(input: { tenantId?: string; limit?: number } = {}) {
  const params: unknown[] = [];
  const conditions: string[] = [];
  if (input.tenantId) {
    params.push(input.tenantId);
    conditions.push(`a.tenant_id = $${params.length}`);
  }
  const limit = Math.min(Math.max(input.limit ?? 12, 1), 50);
  params.push(limit);
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const guardComment = input.tenantId
    ? ""
    : "/* tenant-query-guard: ignore internal-backoffice-global-audit-preview */";

  const result = await db.query<AuditPreviewRow>(
    `${guardComment}
     SELECT a.id,
            a.tenant_id,
            a.action,
            a.entity_type,
            a.entity_id,
            u.email AS actor_email,
            a.created_at::text
     FROM audit_logs a
     LEFT JOIN users u
       ON u.id = a.actor_user_id
     ${where}
     ORDER BY a.created_at DESC
     LIMIT $${params.length}`,
    params
  );

  return result.rows.map(mapAuditPreview);
}
