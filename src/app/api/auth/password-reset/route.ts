import { createHash } from "crypto";
import { z } from "zod";
import { db } from "@/server/db";
import { hashPassword } from "@/server/auth/password";
import { revokeUserSessions } from "@/server/auth/session";
import { recordAuditLog } from "@/server/audit";

const resetSchema = z.object({
  token: z.string().min(10),
  password: z.string().min(8)
});

export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch (error) {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = resetSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json({ error: "Invalid payload" }, { status: 400 });
  }

  const tokenHash = createHash("sha256").update(parsed.data.token).digest("hex");
  const resetResult = await db.query(
    `SELECT pr.id, pr.user_id, pr.expires_at, pr.used_at,
            COALESCE(pr.tenant_key, u.tenant_key, 'primary') AS tenant_key,
            COALESCE(pr.workspace_key, u.workspace_key, 'primary') AS workspace_key
     FROM password_resets pr
     JOIN users u
       ON u.id = pr.user_id
      AND u.tenant_key = pr.tenant_key
      AND u.workspace_key = pr.workspace_key
     WHERE pr.token_hash = $1
     ORDER BY pr.created_at DESC
     LIMIT 1`,
    [tokenHash]
  );

  const reset = resetResult.rows[0];
  if (!reset) {
    return Response.json({ error: "Invalid token" }, { status: 400 });
  }

  if (reset.used_at) {
    return Response.json({ error: "Token already used" }, { status: 400 });
  }

  if (new Date(reset.expires_at) < new Date()) {
    return Response.json({ error: "Token expired" }, { status: 400 });
  }

  const passwordHash = hashPassword(parsed.data.password);
  await db.query(
    `UPDATE users
     SET password_hash = $1, updated_at = now()
     WHERE id = $2
       AND tenant_key = $3
       AND workspace_key = $4`,
    [passwordHash, reset.user_id, reset.tenant_key, reset.workspace_key]
  );
  await db.query(
    `UPDATE password_resets
     SET used_at = now()
     WHERE id = $1
       AND tenant_key = $2
       AND workspace_key = $3`,
    [reset.id, reset.tenant_key, reset.workspace_key]
  );
  const revokedSessionCount = await revokeUserSessions({
    userId: reset.user_id,
    tenantKey: reset.tenant_key,
    workspaceKey: reset.workspace_key,
    reason: "password_reset"
  });

  await recordAuditLog({
    tenantKey: reset.tenant_key,
    workspaceKey: reset.workspace_key,
    action: "password_reset_completed",
    entityType: "user",
    entityId: reset.user_id,
    data: { revokedSessionCount }
  });

  if (revokedSessionCount > 0) {
    await recordAuditLog({
      tenantKey: reset.tenant_key,
      workspaceKey: reset.workspace_key,
      action: "auth_sessions_revoked",
      entityType: "user",
      entityId: reset.user_id,
      data: { reason: "password_reset", revokedSessionCount }
    });
  }

  return Response.json({
    status: "updated",
    revokedSessionCount
  });
}
