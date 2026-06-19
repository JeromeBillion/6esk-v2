import { randomBytes, createHash } from "crypto";
import { getSessionUser } from "@/server/auth/session";
import { isLeadAdmin } from "@/server/auth/roles";
import { sessionTenantId } from "@/server/auth/tenant-session";
import { db } from "@/server/db";
import { getEnv } from "@/server/env";
import { recordAuditLog } from "@/server/audit";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  const user = await getSessionUser();
  if (!isLeadAdmin(user)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { userId } = await params;
  const tenantId = sessionTenantId(user);
  if (!tenantId) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const result = await db.query("SELECT id, email FROM users WHERE id = $1 AND tenant_id = $2", [userId, tenantId]);
  const target = result.rows[0];
  if (!target) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const token = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000);

  await db.query(
    `INSERT INTO password_resets (tenant_id, user_id, token_hash, expires_at)
     SELECT tenant_id, id, $2, $3
     FROM users
     WHERE id = $1
       AND tenant_id = $4`,
    [target.id, tokenHash, expiresAt, tenantId]
  );

  await recordAuditLog({
    tenantId,
    actorUserId: user?.id ?? null,
    action: "password_reset_requested",
    entityType: "user",
    entityId: target.id,
    data: { email: target.email }
  });

  const env = getEnv();
  const resetLink = `${env.APP_URL.replace(/\/+$/, "")}/reset-password?token=${token}`;

  return Response.json({
    status: "created",
    resetLink,
    expiresAt: expiresAt.toISOString()
  });
}
