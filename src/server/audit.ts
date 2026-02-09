import { db } from "@/server/db";

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
