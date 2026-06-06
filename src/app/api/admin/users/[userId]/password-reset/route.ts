import { randomBytes, createHash } from "crypto";
import { requireLeadAdminAccess } from "@/server/auth/admin-guard";
import { db } from "@/server/db";
import { getEnv } from "@/server/env";
import { recordAuditLog } from "@/server/audit";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  const auth = await requireLeadAdminAccess({ requireMfa: true });
  if (!auth.ok) return auth.response;
  const { user, scope } = auth;

  const { userId } = await params;
  const result = await db.query(
    `SELECT id, email, tenant_key, workspace_key
     FROM users
     WHERE id = $1
       AND tenant_key = $2
       AND workspace_key = $3`,
    [userId, scope.tenantKey, scope.workspaceKey]
  );
  const target = result.rows[0];
  if (!target) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const token = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000);

  await db.query(
    `INSERT INTO password_resets (tenant_key, workspace_key, user_id, token_hash, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [scope.tenantKey, scope.workspaceKey, target.id, tokenHash, expiresAt]
  );

  await recordAuditLog({
    tenantKey: scope.tenantKey,
    workspaceKey: scope.workspaceKey,
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
