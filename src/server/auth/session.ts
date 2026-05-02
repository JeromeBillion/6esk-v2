import { createHash, randomBytes } from "crypto";
import { cookies } from "next/headers";
import { db } from "@/server/db";

export type SessionUser = {
  id: string;
  email: string;
  display_name: string;
  role_id: string | null;
  role_name: string | null;
  tenant_id: string;
  tenant_slug: string;
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

  await db.query(
    `INSERT INTO auth_sessions (user_id, token_hash, expires_at)
     VALUES ($1, $2, $3)`,
    [userId, tokenHash, expiresAt]
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
  await db.query("DELETE FROM auth_sessions WHERE token_hash = $1", [tokenHash]);
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
            u.tenant_id, COALESCE(t.slug, 'default') AS tenant_slug
     FROM auth_sessions s
     JOIN users u ON u.id = s.user_id
     LEFT JOIN roles r ON r.id = u.role_id
     LEFT JOIN tenants t ON t.id = u.tenant_id
     WHERE s.token_hash = $1
       AND s.expires_at > now()
       AND u.is_active = true
     LIMIT 1`,
    [tokenHash]
  );

  return result.rows[0] ?? null;
}
