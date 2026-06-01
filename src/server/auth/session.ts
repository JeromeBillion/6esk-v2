import { createHash, randomBytes } from "crypto";
import { cookies } from "next/headers";
import { db } from "@/server/db";

export type SessionUser = {
  id: string;
  email: string;
  display_name: string;
  role_id: string | null;
  role_name: string | null;
  tenant_key?: string | null;
  workspace_key?: string | null;
};

const COOKIE_NAME = process.env.SESSION_COOKIE_NAME ?? "sixesk_session";
const SESSION_TTL_DAYS = Number(process.env.SESSION_TTL_DAYS ?? 14);

function hashToken(token: string) {
  const secret = process.env.SESSION_SECRET ?? "";
  return createHash("sha256").update(`${token}:${secret}`).digest("hex");
}

export async function createSession(userId: string) {
  const token = randomBytes(32).toString("hex");
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
  const userResult = await db.query<{ tenant_key: string; workspace_key: string }>(
    `SELECT COALESCE(tenant_key, 'primary') AS tenant_key,
            COALESCE(workspace_key, 'primary') AS workspace_key
     FROM users
     WHERE id = $1
     LIMIT 1`,
    [userId]
  );
  const tenantKey = userResult.rows[0]?.tenant_key ?? "primary";
  const workspaceKey = userResult.rows[0]?.workspace_key ?? "primary";

  await db.query(
    `INSERT INTO auth_sessions (tenant_key, workspace_key, user_id, token_hash, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [tenantKey, workspaceKey, userId, tokenHash, expiresAt]
  );

  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt
  });
}

export async function clearSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) {
    return;
  }
  const tokenHash = hashToken(token);
  await db.query(
    `WITH current_session AS (
       SELECT tenant_key, workspace_key
       FROM auth_sessions
       WHERE token_hash = $1
       LIMIT 1
     )
     DELETE FROM auth_sessions s
     USING current_session
     WHERE s.token_hash = $1
       AND s.tenant_key = current_session.tenant_key
       AND s.workspace_key = current_session.workspace_key`,
    [tokenHash]
  );
  cookieStore.set(COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: new Date(0)
  });
}

export async function getSessionUser() {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) {
    return null;
  }

  const tokenHash = hashToken(token);
  const result = await db.query<SessionUser>(
    `SELECT u.id, u.email, u.display_name, u.role_id, r.name AS role_name,
            COALESCE(u.tenant_key, 'primary') AS tenant_key,
            COALESCE(u.workspace_key, 'primary') AS workspace_key
     FROM auth_sessions s
     JOIN users u ON u.id = s.user_id
     LEFT JOIN roles r ON r.id = u.role_id
     WHERE s.token_hash = $1
       AND s.expires_at > now()
       AND u.is_active = true
       AND s.tenant_key = u.tenant_key
       AND s.workspace_key = u.workspace_key
     LIMIT 1`,
    [tokenHash]
  );

  return result.rows[0] ?? null;
}
