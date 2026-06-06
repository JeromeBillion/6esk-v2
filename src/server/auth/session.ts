import { createHash, createHmac, randomBytes } from "crypto";
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
  session_auth_provider?: string | null;
};

export type SessionContext = {
  sessionId: string;
  authProvider: string;
  user: SessionUser;
};

export type UserSessionSummary = {
  id: string;
  auth_provider: string;
  created_at: string | Date;
  last_seen_at: string | Date | null;
  expires_at: string | Date;
  revoked_at: string | Date | null;
  revoke_reason: string | null;
  has_device_fingerprint: boolean;
};

type CreateSessionOptions = {
  authProvider?: string;
  requestHeaders?: Headers | null;
};

type RevokeUserSessionsInput = {
  userId: string;
  tenantKey: string;
  workspaceKey: string;
  reason: string;
};

type RevokeSessionForUserInput = {
  sessionId: string;
  user: SessionUser;
  reason: string;
};

const COOKIE_NAME = process.env.SESSION_COOKIE_NAME ?? "sixesk_session";
const SESSION_TTL_DAYS = Number(process.env.SESSION_TTL_DAYS ?? 14);

function normalizeSessionTtlDays(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return SESSION_TTL_DAYS;
  return Math.min(Math.max(Math.trunc(numeric), 1), 90);
}

function hashToken(token: string) {
  const secret = process.env.SESSION_SECRET ?? "";
  return createHash("sha256").update(`${token}:${secret}`).digest("hex");
}

function hashFingerprint(value: string | null | undefined) {
  const normalized = value?.trim();
  if (!normalized) return null;
  const secret = process.env.SESSION_SECRET ?? "";
  return createHmac("sha256", secret).update(normalized).digest("hex");
}

function clientIpFromHeaders(headers?: Headers | null) {
  const forwarded = headers?.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || headers?.get("x-real-ip")?.trim() || headers?.get("cf-connecting-ip")?.trim() || null;
}

function userAgentFromHeaders(headers?: Headers | null) {
  return headers?.get("user-agent")?.trim() || null;
}

async function currentTokenHash() {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  return token ? hashToken(token) : null;
}

export async function createSession(userId: string, options: CreateSessionOptions = {}) {
  const token = randomBytes(32).toString("hex");
  const tokenHash = hashToken(token);
  const authProvider = options.authProvider?.trim() || "password";
  const userAgentHash = hashFingerprint(userAgentFromHeaders(options.requestHeaders));
  const ipHash = hashFingerprint(clientIpFromHeaders(options.requestHeaders));
  const userResult = await db.query<{
    tenant_key: string;
    workspace_key: string;
    session_ttl_days: number | null;
  }>(
    `SELECT COALESCE(u.tenant_key, 'primary') AS tenant_key,
            COALESCE(u.workspace_key, 'primary') AS workspace_key,
            p.session_ttl_days
     FROM users u
     LEFT JOIN tenant_security_policies p
       ON p.tenant_key = u.tenant_key
      AND p.workspace_key = u.workspace_key
     WHERE u.id = $1
     LIMIT 1`,
    [userId]
  );
  const tenantKey = userResult.rows[0]?.tenant_key ?? "primary";
  const workspaceKey = userResult.rows[0]?.workspace_key ?? "primary";
  const sessionTtlDays = normalizeSessionTtlDays(userResult.rows[0]?.session_ttl_days);
  const expiresAt = new Date(Date.now() + sessionTtlDays * 24 * 60 * 60 * 1000);

  await db.query(
    `INSERT INTO auth_sessions (
       tenant_key,
       workspace_key,
       user_id,
       token_hash,
       expires_at,
       auth_provider,
       user_agent_hash,
       ip_hash
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [tenantKey, workspaceKey, userId, tokenHash, expiresAt, authProvider, userAgentHash, ipHash]
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

export async function revokeUserSessions({
  userId,
  tenantKey,
  workspaceKey,
  reason
}: RevokeUserSessionsInput) {
  const result = await db.query(
    `UPDATE auth_sessions
     SET revoked_at = now(),
         revoke_reason = $4
     WHERE user_id = $1
       AND tenant_key = $2
       AND workspace_key = $3
       AND revoked_at IS NULL`,
    [userId, tenantKey, workspaceKey, reason]
  );

  return result.rowCount ?? 0;
}

export async function getSessionUser() {
  const context = await getSessionContext();
  return context
    ? {
        ...context.user,
        session_auth_provider: context.authProvider
      }
    : null;
}

export async function getSessionContext(): Promise<SessionContext | null> {
  const tokenHash = await currentTokenHash();
  if (!tokenHash) {
    return null;
  }

  const result = await db.query<SessionUser & { session_id: string; session_auth_provider: string }>(
    `SELECT s.id AS session_id,
            s.auth_provider AS session_auth_provider,
            u.id, u.email, u.display_name, u.role_id, r.name AS role_name,
            COALESCE(u.tenant_key, 'primary') AS tenant_key,
            COALESCE(u.workspace_key, 'primary') AS workspace_key
     FROM auth_sessions s
     JOIN users u ON u.id = s.user_id
     LEFT JOIN roles r ON r.id = u.role_id
     WHERE s.token_hash = $1
       AND s.expires_at > now()
       AND s.revoked_at IS NULL
       AND u.is_active = true
       AND s.tenant_key = u.tenant_key
       AND s.workspace_key = u.workspace_key
     LIMIT 1`,
    [tokenHash]
  );

  const row = result.rows[0];
  if (!row) {
    return null;
  }

  const { session_id: sessionId, session_auth_provider: authProvider, ...user } = row;
  await db.query(
    `UPDATE auth_sessions
     SET last_seen_at = now()
     WHERE id = $1
       AND tenant_key = $2
       AND workspace_key = $3
       AND revoked_at IS NULL`,
    [sessionId, user.tenant_key ?? "primary", user.workspace_key ?? "primary"]
  ).catch(() => {});

  return {
    sessionId,
    authProvider,
    user
  };
}

export async function listUserSessions(user: SessionUser) {
  const result = await db.query<UserSessionSummary>(
    `SELECT id,
            auth_provider,
            created_at,
            last_seen_at,
            expires_at,
            revoked_at,
            revoke_reason,
            (user_agent_hash IS NOT NULL OR ip_hash IS NOT NULL) AS has_device_fingerprint
     FROM auth_sessions
     WHERE user_id = $1
       AND tenant_key = $2
       AND workspace_key = $3
     ORDER BY revoked_at IS NULL DESC, created_at DESC
     LIMIT 50`,
    [user.id, user.tenant_key ?? "primary", user.workspace_key ?? "primary"]
  );
  return result.rows;
}

export async function revokeSessionForUser({ sessionId, user, reason }: RevokeSessionForUserInput) {
  const result = await db.query(
    `UPDATE auth_sessions
     SET revoked_at = now(),
         revoke_reason = $5
     WHERE id = $1
       AND user_id = $2
       AND tenant_key = $3
       AND workspace_key = $4
       AND revoked_at IS NULL`,
    [sessionId, user.id, user.tenant_key ?? "primary", user.workspace_key ?? "primary", reason]
  );

  return (result.rowCount ?? 0) > 0;
}
