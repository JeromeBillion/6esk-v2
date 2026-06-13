import { createHash, createHmac, randomBytes } from "crypto";
import { cookies } from "next/headers";
import { db } from "@/server/db";

export type SessionUser = {
  id: string;
  email: string;
  display_name: string;
  role_id: string | null;
  role_name: string | null;
  tenant_id: string; // Effective tenant
  tenant_slug: string; // Effective slug
  real_tenant_id: string; // Home tenant
  is_impersonating: boolean;
  session_auth_provider?: string | null;
};

type SessionUserRow = {
  id: string;
  email: string;
  display_name: string;
  role_id: string | null;
  role_name: string | null;
  real_tenant_id: string | null;
  home_tenant_slug: string | null;
  impersonated_tenant_id: string | null;
  impersonated_tenant_slug: string | null;
  impersonation_expires_at: Date | string | null;
  session_auth_provider: string | null;
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

export async function createSession(userId: string, options: CreateSessionOptions = {}) {
  const token = randomBytes(32).toString("hex");
  const tokenHash = hashToken(token);
  const authProvider = options.authProvider?.trim() || "password";
  const userAgentHash = hashFingerprint(userAgentFromHeaders(options.requestHeaders));
  const ipHash = hashFingerprint(clientIpFromHeaders(options.requestHeaders));
  const userResult = await db.query<{
    tenant_id: string;
    session_ttl_days: number | null;
  }>(
    `SELECT u.tenant_id, p.session_ttl_days
     FROM users u
     LEFT JOIN tenant_security_policies p
       ON p.tenant_id = u.tenant_id
      AND p.workspace_key = 'primary'
     WHERE u.id = $1
     LIMIT 1`,
    [userId]
  );
  const userRow = userResult.rows[0];
  if (!userRow?.tenant_id) {
    throw new Error("Cannot create session without tenant scope");
  }

  const sessionTtlDays = normalizeSessionTtlDays(userRow.session_ttl_days);
  const expiresAt = new Date(Date.now() + sessionTtlDays * 24 * 60 * 60 * 1000);

  const sessionResult = await db.query<{ id: string }>(
    `INSERT INTO auth_sessions (
       user_id,
       token_hash,
       expires_at,
       auth_provider,
       user_agent_hash,
       ip_hash
     )
     SELECT id, $2, $3, $4, $5, $6
     FROM users
     WHERE id = $1
       AND tenant_id = $7
     RETURNING id`,
    [userId, tokenHash, expiresAt, authProvider, userAgentHash, ipHash, userRow.tenant_id]
  );
  if (sessionResult.rows.length === 0) {
    throw new Error("Cannot create session without tenant scope");
  }

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
    `UPDATE auth_sessions s
     SET revoked_at = now(),
         revoke_reason = 'logout'
     FROM users u
     WHERE s.token_hash = $1
       AND s.user_id = u.id
       AND u.tenant_id IS NOT NULL
       AND s.revoked_at IS NULL`,
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

function isInternalSupportRole(roleName: string | null) {
  return roleName === "internal_admin" || roleName === "internal_support";
}

function isImpersonationActive(expiresAt: Date | string | null) {
  if (!expiresAt) return false;
  const parsed =
    expiresAt instanceof Date ? expiresAt : new Date(expiresAt);
  if (Number.isNaN(parsed.getTime())) return false;
  return parsed.getTime() > Date.now();
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) {
    return null;
  }

  const tokenHash = hashToken(token);
  const result = await db.query<SessionUserRow>(
    `SELECT u.id, u.email, u.display_name, u.role_id, r.name AS role_name,
            u.tenant_id AS real_tenant_id,
            COALESCE(t.slug, 'default') AS home_tenant_slug,
            s.impersonated_tenant_id AS impersonated_tenant_id,
            it.slug AS impersonated_tenant_slug,
            s.impersonation_expires_at AS impersonation_expires_at,
            s.auth_provider AS session_auth_provider
     FROM auth_sessions s
     JOIN users u ON u.id = s.user_id
     LEFT JOIN roles r ON r.id = u.role_id
     JOIN tenants t ON t.id = u.tenant_id
     LEFT JOIN tenants it ON it.id = s.impersonated_tenant_id
     WHERE s.token_hash = $1
       AND s.expires_at > now()
       AND s.revoked_at IS NULL
       AND u.is_active = true
     LIMIT 1`,
    [tokenHash]
  );

  const row = result.rows[0];
  if (!row) return null;
  if (!row.real_tenant_id || !row.home_tenant_slug) return null;

  const impersonatedTenantId =
    isInternalSupportRole(row.role_name) && isImpersonationActive(row.impersonation_expires_at)
      ? row.impersonated_tenant_id
      : null;
  const isImpersonating = impersonatedTenantId !== null;
  const effectiveTenantId = impersonatedTenantId ?? row.real_tenant_id;
  const effectiveTenantSlug = impersonatedTenantId
    ? row.impersonated_tenant_slug ?? "default"
    : row.home_tenant_slug;
  if (!effectiveTenantId || !effectiveTenantSlug) return null;

  return {
    id: row.id,
    email: row.email,
    display_name: row.display_name,
    role_id: row.role_id,
    role_name: row.role_name,
    real_tenant_id: row.real_tenant_id,
    tenant_id: effectiveTenantId,
    tenant_slug: effectiveTenantSlug,
    is_impersonating: isImpersonating,
    session_auth_provider: row.session_auth_provider
  };
}

export async function revokeUserSessions({
  userId,
  reason
}: {
  userId: string;
  reason: string;
}) {
  const result = await db.query(
    `UPDATE auth_sessions s
     SET revoked_at = now(),
         revoke_reason = $2
     FROM users u
     WHERE s.user_id = $1
       AND s.user_id = u.id
       AND u.tenant_id IS NOT NULL
       AND s.revoked_at IS NULL`,
    [userId, reason]
  );
  return result.rowCount ?? 0;
}

function homeTenantIdFor(user: Pick<SessionUser, "tenant_id" | "real_tenant_id">) {
  return user.real_tenant_id || user.tenant_id;
}

export async function listUserSessions(user: Pick<SessionUser, "id" | "tenant_id" | "real_tenant_id">) {
  const result = await db.query<UserSessionSummary>(
    `SELECT s.id,
            s.auth_provider,
            s.created_at,
            s.last_seen_at,
            s.expires_at,
            s.revoked_at,
            s.revoke_reason,
            (s.user_agent_hash IS NOT NULL OR s.ip_hash IS NOT NULL) AS has_device_fingerprint
     FROM auth_sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.user_id = $1
       AND u.tenant_id = $2
     ORDER BY s.revoked_at IS NULL DESC, s.created_at DESC
     LIMIT 50`,
    [user.id, homeTenantIdFor(user)]
  );
  return result.rows;
}

export async function revokeSessionForUser({
  sessionId,
  user,
  reason
}: {
  sessionId: string;
  user: Pick<SessionUser, "id" | "tenant_id" | "real_tenant_id">;
  reason: string;
}) {
  const result = await db.query(
    `UPDATE auth_sessions s
     SET revoked_at = now(),
         revoke_reason = $4
     FROM users u
     WHERE s.id = $1
       AND s.user_id = $2
       AND s.user_id = u.id
       AND u.tenant_id = $3
       AND s.revoked_at IS NULL`,
    [sessionId, user.id, homeTenantIdFor(user), reason]
  );
  return (result.rowCount ?? 0) > 0;
}
