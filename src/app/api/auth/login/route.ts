import { z } from "zod";
import { db } from "@/server/db";
import { createSession } from "@/server/auth/session";
import { verifyPassword } from "@/server/auth/password";
import { createMfaChallenge, hasActiveMfaFactor, isMfaRequiredForLogin } from "@/server/auth/mfa";
import { getTenantSecurityPolicy, isEmailAllowedByPolicy } from "@/server/auth/tenant-security-policy";
import { recordAuditLog, recordPlatformAuditLog } from "@/server/audit";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1)
});

function emailDomain(email: string) {
  return email.trim().toLowerCase().split("@").pop() ?? null;
}

export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch (error) {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = loginSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json({ error: "Invalid credentials" }, { status: 400 });
  }

  const { email, password } = parsed.data;
  const result = await db.query<{
    id: string;
    email: string;
    password_hash: string;
    is_active: boolean;
    tenant_id: string;
    role_name: string | null;
  }>(
    `SELECT u.id, u.email, u.password_hash, u.is_active, u.tenant_id, r.name AS role_name
     FROM users u
     LEFT JOIN roles r ON r.id = u.role_id AND r.tenant_id = u.tenant_id
     WHERE lower(u.email) = $1
     LIMIT 1`,
    [email.toLowerCase()]
  );

  const user = result.rows[0];
  if (!user) {
    await recordPlatformAuditLog({
      actorUserId: null,
      action: "auth_login_failed",
      entityType: "auth_session",
      data: {
        reason: "unknown_user",
        emailDomain: emailDomain(email)
      }
    });
    return Response.json({ error: "Invalid credentials" }, { status: 401 });
  }

  if (!user.is_active) {
    await recordAuditLog({
      tenantId: user.tenant_id,
      actorUserId: null,
      action: "auth_login_failed",
      entityType: "auth_session",
      data: {
        reason: "inactive_user",
        emailDomain: emailDomain(email)
      }
    });
    return Response.json({ error: "Invalid credentials" }, { status: 401 });
  }

  if (!(await verifyPassword(password, user.password_hash))) {
    await recordAuditLog({
      tenantId: user.tenant_id,
      actorUserId: user.id,
      action: "auth_login_failed",
      entityType: "auth_session",
      data: {
        reason: "invalid_password",
        emailDomain: emailDomain(email)
      }
    });
    return Response.json({ error: "Invalid credentials" }, { status: 401 });
  }

  const policy = await getTenantSecurityPolicy({ tenantId: user.tenant_id }).catch(() => null);
  if (policy?.enforce_sso) {
    await recordAuditLog({
      tenantId: user.tenant_id,
      actorUserId: user.id,
      action: "auth_login_failed",
      entityType: "auth_session",
      data: {
        reason: "sso_required",
        emailDomain: emailDomain(email),
        authProvider: policy.auth_provider
      }
    });
    return Response.json({ error: "SSO is required for this account." }, { status: 403 });
  }

  if (
    policy &&
    policy.allowed_login_domains.length > 0 &&
    !isEmailAllowedByPolicy(user.email, policy)
  ) {
    await recordAuditLog({
      tenantId: user.tenant_id,
      actorUserId: user.id,
      action: "auth_login_failed",
      entityType: "auth_session",
      data: {
        reason: "login_domain_denied",
        emailDomain: emailDomain(email)
      }
    });
    return Response.json({ error: "Invalid credentials" }, { status: 401 });
  }

  const mfaRequired = await isMfaRequiredForLogin({
    tenant_id: user.tenant_id,
    role_name: user.role_name
  });
  if (mfaRequired && (await hasActiveMfaFactor(user))) {
    const challenge = await createMfaChallenge(user);
    await recordAuditLog({
      tenantId: user.tenant_id,
      actorUserId: user.id,
      action: "auth_login_mfa_challenge_created",
      entityType: "auth_mfa_challenge",
      data: {
        authProvider: "password",
        emailDomain: emailDomain(email)
      }
    });
    return Response.json({
      status: "mfa_required",
      challengeToken: challenge.challengeToken,
      expiresAt: challenge.expiresAt.toISOString()
    });
  }

  const mfaEnrollmentRequired = mfaRequired;
  const authProvider = mfaEnrollmentRequired ? "password_mfa_enrollment_required" : "password";
  await createSession(user.id, { authProvider, requestHeaders: request.headers });
  await recordAuditLog({
    tenantId: user.tenant_id,
    actorUserId: user.id,
    action: "auth_login_success",
    entityType: "auth_session",
    data: {
      authProvider,
      mfaEnrollmentRequired,
      mfaSatisfied: false
    }
  });
  return Response.json({ status: "ok", mfaEnrollmentRequired });
}
