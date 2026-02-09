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

  const passwordHash = hashPassword(parsed.data.password);
  await db.query("UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2", [
    passwordHash,
    reset.user_id
  ]);
  await db.query("UPDATE password_resets SET used_at = now() WHERE id = $1", [reset.id]);

  await recordAuditLog({
    action: "password_reset_completed",
    entityType: "user",
    entityId: reset.user_id
  });

  return Response.json({ status: "updated" });
}
