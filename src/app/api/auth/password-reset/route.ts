import { createHash } from "crypto";
import { z } from "zod";
import { db } from "@/server/db";
import { hashPassword } from "@/server/auth/password";
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
    `SELECT id, user_id, expires_at, used_at
     FROM password_resets
     WHERE token_hash = $1
     ORDER BY created_at DESC
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

  const passwordHash = await hashPassword(parsed.data.password);
  const client = await db.connect();
  let revokedSessionCount = 0;
  try {
    await client.query("BEGIN");
    await client.query("UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2", [
      passwordHash,
      reset.user_id
    ]);
    await client.query("UPDATE password_resets SET used_at = now() WHERE id = $1", [reset.id]);
    const revoked = await client.query("DELETE FROM auth_sessions WHERE user_id = $1", [
      reset.user_id
    ]);
    revokedSessionCount = revoked.rowCount ?? 0;
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  await recordAuditLog({
    action: "password_reset_completed",
    entityType: "user",
    entityId: reset.user_id,
    data: {
      revokedSessionCount
    }
  });

  if (revokedSessionCount > 0) {
    await recordAuditLog({
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
