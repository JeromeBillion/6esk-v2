import { z } from "zod";
import { db } from "@/server/db";
import { getSessionUser } from "@/server/auth/session";
import { isLeadAdmin } from "@/server/auth/roles";
import { recordAuditLog } from "@/server/audit";
import { tenantScopeFromUser } from "@/server/tenant-context";

const slaSchema = z.object({
  firstResponseMinutes: z.number().int().positive(),
  resolutionMinutes: z.number().int().positive()
});

export async function GET() {
  const user = await getSessionUser();
  if (!isLeadAdmin(user)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  const scope = tenantScopeFromUser(user);

  const result = await db.query(
    `SELECT first_response_target_minutes, resolution_target_minutes
     FROM sla_configs
     WHERE tenant_key = $1
       AND is_active = true
     ORDER BY created_at DESC
     LIMIT 1`,
    [scope.tenantKey]
  );

  const row = result.rows[0];
  if (!row) {
    return Response.json({
      firstResponseMinutes: 120,
      resolutionMinutes: 1440
    });
  }

  return Response.json({
    firstResponseMinutes: row.first_response_target_minutes,
    resolutionMinutes: row.resolution_target_minutes
  });
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!isLeadAdmin(user)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  const scope = tenantScopeFromUser(user);

  let payload: unknown;
  try {
    payload = await request.json();
  } catch (error) {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = slaSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json({ error: "Invalid payload" }, { status: 400 });
  }

  const { firstResponseMinutes, resolutionMinutes } = parsed.data;

  await db.query(
    "UPDATE sla_configs SET is_active = false WHERE tenant_key = $1 AND is_active = true",
    [scope.tenantKey]
  );

  const result = await db.query(
    `INSERT INTO sla_configs (
       tenant_key,
       workspace_key,
       first_response_target_minutes,
       resolution_target_minutes,
       is_active
     )
     VALUES ($1, $2, $3, $4, true)
     RETURNING first_response_target_minutes, resolution_target_minutes`,
    [scope.tenantKey, scope.workspaceKey, firstResponseMinutes, resolutionMinutes]
  );

  const row = result.rows[0];

  await recordAuditLog({
    tenantKey: scope.tenantKey,
    workspaceKey: scope.workspaceKey,
    actorUserId: user?.id ?? null,
    action: "sla_updated",
    entityType: "sla_config",
    data: {
      firstResponseMinutes: row.first_response_target_minutes,
      resolutionMinutes: row.resolution_target_minutes
    }
  });

  return Response.json({
    firstResponseMinutes: row.first_response_target_minutes,
    resolutionMinutes: row.resolution_target_minutes
  });
}
