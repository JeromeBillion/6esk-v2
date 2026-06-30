import { createHash } from "crypto";
import { z } from "zod";
import { db } from "@/server/db";
import { hashPassword } from "@/server/auth/password";
import { recordAuditLog } from "@/server/audit";

const resetSchema = z.object({
  token: z.string().min(10),
  password: z.string().min(8)
});

type PasswordResetRow = {
  id: string;
  user_id: string;
  tenant_id: string;
  expires_at: string | Date;
  used_at: string | Date | null;
};

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
    `SELECT pr.id, pr.user_id, pr.tenant_id, pr.expires_at, pr.used_at
     FROM password_resets pr
     WHERE pr.token_hash = $1
       AND pr.tenant_id IS NOT NULL
     ORDER BY pr.created_at DESC
     LIMIT 1`,
    [tokenHash]
  );

  const reset = resetResult.rows[0] as PasswordResetRow | undefined;
  if (!reset) {
    return Response.json({ error: "Invalid token" }, { status: 400 });
  }

  if (reset.used_at) {
    return Response.json({ error: "Token already used" }, { status: 400 });
  }

  if (new Date(reset.expires_at) < new Date()) {
    return Response.json({ error: "Token expired" }, { status: 400 });
  }

  const passwordHash = await hashPassword(parsed.data.password);
  const client = await db.connect();
  let revokedSessionCount = 0;
  try {
    await client.query("BEGIN");
    const lockedResetResult = await client.query(
      `SELECT pr.id, pr.user_id, pr.tenant_id, pr.expires_at, pr.used_at
       FROM password_resets pr
       WHERE pr.id = $1
         AND pr.tenant_id = $2
       FOR UPDATE`,
      [reset.id, reset.tenant_id]
    );
    const lockedReset = lockedResetResult.rows[0] as PasswordResetRow | undefined;
    if (!lockedReset) {
      await client.query("ROLLBACK");
      return Response.json({ error: "Invalid token" }, { status: 400 });
    }

    if (lockedReset.used_at) {
      await client.query("ROLLBACK");
      return Response.json({ error: "Token already used" }, { status: 400 });
    }

    if (new Date(lockedReset.expires_at) < new Date()) {
      await client.query("ROLLBACK");
      return Response.json({ error: "Token expired" }, { status: 400 });
    }

    await client.query("UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2 AND tenant_id = $3", [
      passwordHash,
      lockedReset.user_id,
      lockedReset.tenant_id
    ]);
    const consumed = await client.query(
      `UPDATE password_resets
       SET used_at = now()
       WHERE id = $1
         AND tenant_id = $2
         AND used_at IS NULL`,
      [lockedReset.id, lockedReset.tenant_id]
    );
    if ((consumed.rowCount ?? 0) !== 1) {
      await client.query("ROLLBACK");
      return Response.json({ error: "Token already used" }, { status: 400 });
    }
    const revoked = await client.query(
      `UPDATE auth_sessions s
       SET revoked_at = now(),
           revoke_reason = 'password_reset'
       FROM users u
       WHERE s.user_id = $1
         AND s.user_id = u.id
         AND u.tenant_id = $2
         AND s.revoked_at IS NULL`,
      [lockedReset.user_id, lockedReset.tenant_id]
    );
    revokedSessionCount = revoked.rowCount ?? 0;
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  await recordAuditLog({
    tenantId: reset.tenant_id,
    action: "password_reset_completed",
    entityType: "user",
    entityId: reset.user_id,
    data: {
      revokedSessionCount
    }
  });

  if (revokedSessionCount > 0) {
    await recordAuditLog({
      tenantId: reset.tenant_id,
      action: "password_reset_sessions_revoked",
      entityType: "user",
      entityId: reset.user_id,
      data: {
        revokedSessionCount
      }
    });
  }

  return Response.json({ status: "updated" });
}
