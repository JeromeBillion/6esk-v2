import { z } from "zod";
import { db } from "@/server/db";
import { getSessionUser } from "@/server/auth/session";
import { isInternalStaff } from "@/server/auth/roles";

const querySchema = z.object({
  tenantId: z.string().uuid().optional(),
  entityType: z.string().optional(),
  action: z.string().optional(),
  limit: z.coerce.number().min(1).max(500).optional().default(100),
  offset: z.coerce.number().min(0).optional().default(0)
});

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!isInternalStaff(user)) {
    return Response.json({ error: "Forbidden. 6esk Staff only." }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const parsed = querySchema.safeParse({
    tenantId: searchParams.get("tenantId") || undefined,
    entityType: searchParams.get("entityType") || undefined,
    action: searchParams.get("action") || undefined,
    limit: searchParams.get("limit") || undefined,
    offset: searchParams.get("offset") || undefined
  });

  if (!parsed.success) {
    return Response.json({ error: "Invalid query parameters" }, { status: 400 });
  }

  const { tenantId, entityType, action, limit, offset } = parsed.data;

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (tenantId) {
    params.push(tenantId);
    conditions.push(`tenant_id = $${params.length}`);
  }

  if (entityType) {
    params.push(entityType);
    conditions.push(`entity_type = $${params.length}`);
  }

  if (action) {
    params.push(action);
    conditions.push(`action = $${params.length}`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  params.push(limit);
  const limitIdx = params.length;
  params.push(offset);
  const offsetIdx = params.length;

  const result = await db.query(
    `SELECT id, tenant_id, actor_user_id, action, entity_type, entity_id, data, created_at
     FROM audit_logs
     ${whereClause}
     ORDER BY created_at DESC
     LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    params
  );

  return Response.json({ logs: result.rows });
}
