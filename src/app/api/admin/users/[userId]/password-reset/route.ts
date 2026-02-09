import { randomBytes, createHash } from "crypto";
import { getSessionUser } from "@/server/auth/session";
import { isLeadAdmin } from "@/server/auth/roles";
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
  const result = await db.query("SELECT id, email FROM users WHERE id = $1", [userId]);
  const target = result.rows[0];
  if (!target) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const token = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000);

  await db.query(
    `INSERT INTO password_resets (user_id, token_hash, expires_at)
     VALUES ($1, $2, $3)`,
    [target.id, tokenHash, expiresAt]
  );

  await recordAuditLog({
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
