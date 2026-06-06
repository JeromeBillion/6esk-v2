import { z } from "zod";
import { db } from "@/server/db";
import { createSession } from "@/server/auth/session";
import { verifyPassword } from "@/server/auth/password";
import { createMfaChallenge, hasActiveMfaFactor, isMfaRequiredForLogin } from "@/server/auth/mfa";
import { recordAuditLog } from "@/server/audit";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  tenantKey: z.string().min(1).optional()
});

type LoginUserRow = {
  id: string;
  email: string;
  password_hash: string;
  is_active: boolean;
  tenant_key: string;
  workspace_key: string;
  role_name: string | null;
};

function emailDomain(email: string) {
  return email.split("@")[1]?.toLowerCase() ?? null;
}

async function recordLoginFailure({
  tenantKey,
  user,
  email,
  reason
}: {
  tenantKey: string;
  user?: LoginUserRow | null;
  email: string;
  reason: "unknown_user" | "inactive_user" | "invalid_password";
}) {
  await recordAuditLog({
    tenantKey: user?.tenant_key ?? tenantKey,
    workspaceKey: user?.workspace_key ?? "primary",
    actorUserId: user?.id ?? null,
    action: "auth_login_failed",
    entityType: "auth_session",
    data: {
      authProvider: "password",
      reason,
      emailDomain: emailDomain(email)
    }
  }).catch(() => {});
}

async function recordLoginSuccess(user: LoginUserRow, data: Record<string, unknown>) {
  await recordAuditLog({
    tenantKey: user.tenant_key,
    workspaceKey: user.workspace_key,
    actorUserId: user.id,
    action: "auth_login_success",
    entityType: "auth_session",
    data: {
      authProvider: "password",
      ...data
    }
  }).catch(() => {});
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
  const tenantKey = parsed.data.tenantKey?.trim() || "primary";
  const result = await db.query<LoginUserRow>(
    `SELECT u.id,
            u.email,
            u.password_hash,
            u.is_active,
            COALESCE(u.tenant_key, 'primary') AS tenant_key,
            COALESCE(u.workspace_key, 'primary') AS workspace_key,
            r.name AS role_name
     FROM users u
     LEFT JOIN roles r ON r.id = u.role_id
     WHERE u.tenant_key = $1
       AND lower(u.email) = $2
     LIMIT 1`,
    [tenantKey, email.toLowerCase()]
  );

  const user = result.rows[0];
  if (!user) {
    await recordLoginFailure({ tenantKey, user: null, email, reason: "unknown_user" });
    return Response.json({ error: "Invalid credentials" }, { status: 401 });
  }

  if (!user.is_active) {
    await recordLoginFailure({ tenantKey, user, email, reason: "inactive_user" });
    return Response.json({ error: "Invalid credentials" }, { status: 401 });
  }

  if (!verifyPassword(password, user.password_hash)) {
    await recordLoginFailure({ tenantKey, user, email, reason: "invalid_password" });
    return Response.json({ error: "Invalid credentials" }, { status: 401 });
  }

  const mfaRequired = await isMfaRequiredForLogin(user);
  if (mfaRequired && (await hasActiveMfaFactor(user))) {
    const challenge = await createMfaChallenge(user);
    await recordAuditLog({
      tenantKey: user.tenant_key,
      workspaceKey: user.workspace_key,
      actorUserId: user.id,
      action: "auth_mfa_challenge_created",
      entityType: "auth_mfa_challenge",
      data: {
        authProvider: "password"
      }
    }).catch(() => {});
    return Response.json({
      status: "mfa_required",
      challengeToken: challenge.challengeToken,
      expiresAt: challenge.expiresAt
    });
  }

  await createSession(user.id, {
    authProvider: mfaRequired ? "password_mfa_enrollment_required" : "password",
    requestHeaders: request.headers
  });
  await recordLoginSuccess(user, {
    mfaEnrollmentRequired: mfaRequired,
    mfaSatisfied: false
  });
  if (mfaRequired) {
    await recordAuditLog({
      tenantKey: user.tenant_key,
      workspaceKey: user.workspace_key,
      actorUserId: user.id,
      action: "auth_mfa_enrollment_required",
      entityType: "auth_mfa_factor",
      data: {
        authProvider: "password"
      }
    }).catch(() => {});
  }
  return Response.json({
    status: "ok",
    mfaEnrollmentRequired: mfaRequired
  });
}
