import { z } from "zod";
import { db } from "@/server/db";
import { getSessionUser } from "@/server/auth/session";
import { isLeadAdmin } from "@/server/auth/roles";
import { recordAuditLog } from "@/server/audit";

const slaSchema = z.object({
  firstResponseMinutes: z.number().int().positive(),
  resolutionMinutes: z.number().int().positive()
});

export async function GET() {
  const user = await getSessionUser();
  if (!isLeadAdmin(user)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const result = await db.query(
    `SELECT first_response_target_minutes, resolution_target_minutes
     FROM sla_configs
     WHERE is_active = true
     ORDER BY created_at DESC
     LIMIT 1`
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

  await db.query("UPDATE sla_configs SET is_active = false WHERE is_active = true");

  const result = await db.query(
    `INSERT INTO sla_configs (first_response_target_minutes, resolution_target_minutes, is_active)
     VALUES ($1, $2, true)
     RETURNING first_response_target_minutes, resolution_target_minutes`,
    [firstResponseMinutes, resolutionMinutes]
  );

  const row = result.rows[0];

  await recordAuditLog({
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
