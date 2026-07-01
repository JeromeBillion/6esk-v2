import { cookies } from "next/headers";
import { createMfaChallenge, hasActiveMfaFactor, isMfaRequiredForLogin } from "@/server/auth/mfa";
import {
  exchangeAuthOAuthCode,
  fetchAuthOAuthProfile,
  parseAuthOAuthState,
  sanitizeAuthReturnTo
} from "@/server/auth/oauth-login";
import { createSession } from "@/server/auth/session";
import { getTenantSecurityPolicy, isEmailAllowedByPolicy } from "@/server/auth/tenant-security-policy";
import { recordAuditLog, recordPlatformAuditLog } from "@/server/audit";
import { db } from "@/server/db";

const AUTH_OAUTH_NONCE_COOKIE = "sixesk_auth_oauth_nonce";
const AUTH_OAUTH_MFA_CHALLENGE_COOKIE = "sixesk_auth_oauth_mfa_challenge";
const AUTH_OAUTH_MFA_COOKIE_TTL_SECONDS = 10 * 60;

type AuthOAuthUserRow = {
  id: string;
  email: string;
  is_active: boolean;
  tenant_id: string;
  role_name: string | null;
};

function emailDomain(email: string) {
  return email.trim().toLowerCase().split("@").pop() ?? null;
}

function loginRedirect(request: Request, params: Record<string, string>) {
  const url = new URL("/login", request.url);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return Response.redirect(url);
}

function appRedirect(request: Request, returnTo: string) {
  return Response.redirect(new URL(sanitizeAuthReturnTo(returnTo), request.url));
}

async function clearNonceCookie() {
  const cookieStore = await cookies();
  cookieStore.set(AUTH_OAUTH_NONCE_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/api/auth/oauth",
    expires: new Date(0)
  });
}

async function setOAuthMfaChallengeCookie(challengeToken: string) {
  const cookieStore = await cookies();
  cookieStore.set(AUTH_OAUTH_MFA_CHALLENGE_COOKIE, challengeToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/api/auth/mfa",
    maxAge: AUTH_OAUTH_MFA_COOKIE_TTL_SECONDS
  });
}

async function findUserByEmail(email: string) {
  const result = await db.query<AuthOAuthUserRow>(
    `SELECT u.id, u.email, u.is_active, u.tenant_id, r.name AS role_name
     FROM users u
     LEFT JOIN roles r ON r.id = u.role_id AND r.tenant_id = u.tenant_id
     WHERE lower(u.email) = $1
     LIMIT 1`,
    [email.toLowerCase()]
  );
  return result.rows[0] ?? null;
}

function isManagedOAuthPolicy(authProvider: string | null | undefined) {
  const normalized = authProvider?.trim().toLowerCase();
  return normalized === "oauth" || normalized === "better_auth";
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const providerError = url.searchParams.get("error");
  if (providerError) {
    return loginRedirect(request, { error: "oauth_provider_denied" });
  }

  const code = url.searchParams.get("code");
  const state = parseAuthOAuthState(url.searchParams.get("state"));
  if (!code || !state) {
    return loginRedirect(request, { error: "oauth_invalid_state" });
  }

  const cookieStore = await cookies();
  const expectedNonce = cookieStore.get(AUTH_OAUTH_NONCE_COOKIE)?.value;
  await clearNonceCookie();
  if (!expectedNonce || expectedNonce !== state.nonce) {
    return loginRedirect(request, { error: "oauth_invalid_state" });
  }

  let profile: Awaited<ReturnType<typeof fetchAuthOAuthProfile>>;
  try {
    const tokens = await exchangeAuthOAuthCode(state.provider, code);
    profile = await fetchAuthOAuthProfile(state.provider, tokens.accessToken);
  } catch (error) {
    await recordPlatformAuditLog({
      actorUserId: null,
      action: "auth_oauth_login_failed",
      entityType: "auth_session",
      data: {
        reason: "provider_exchange_failed",
        provider: state.provider
      }
    });
    return loginRedirect(request, { error: "oauth_exchange_failed" });
  }

  if (profile.emailVerified === false) {
    await recordPlatformAuditLog({
      actorUserId: null,
      action: "auth_oauth_login_failed",
      entityType: "auth_session",
      data: {
        reason: "provider_email_unverified",
        provider: state.provider,
        emailDomain: emailDomain(profile.email)
      }
    });
    return loginRedirect(request, { error: "oauth_unverified_email" });
  }

  const user = await findUserByEmail(profile.email);
  if (!user) {
    await recordPlatformAuditLog({
      actorUserId: null,
      action: "auth_oauth_login_failed",
      entityType: "auth_session",
      data: {
        reason: "unknown_user",
        provider: state.provider,
        emailDomain: emailDomain(profile.email)
      }
    });
    return loginRedirect(request, { error: "oauth_invalid_account" });
  }

  if (!user.is_active) {
    await recordAuditLog({
      tenantId: user.tenant_id,
      actorUserId: user?.id ?? null,
      action: "auth_oauth_login_failed",
      entityType: "auth_session",
      data: {
        reason: "inactive_user",
        provider: state.provider,
        emailDomain: emailDomain(profile.email)
      }
    });
    return loginRedirect(request, { error: "oauth_invalid_account" });
  }

  const policy = await getTenantSecurityPolicy({ tenantId: user.tenant_id }).catch(() => null);
  if (
    policy &&
    policy.allowed_login_domains.length > 0 &&
    !isEmailAllowedByPolicy(user.email, policy)
  ) {
    await recordAuditLog({
      tenantId: user.tenant_id,
      actorUserId: user.id,
      action: "auth_oauth_login_failed",
      entityType: "auth_session",
      data: {
        reason: "login_domain_denied",
        provider: state.provider,
        emailDomain: emailDomain(profile.email)
      }
    });
    return loginRedirect(request, { error: "oauth_invalid_account" });
  }

  if (policy?.enforce_sso && !isManagedOAuthPolicy(policy.auth_provider)) {
    await recordAuditLog({
      tenantId: user.tenant_id,
      actorUserId: user.id,
      action: "auth_oauth_login_failed",
      entityType: "auth_session",
      data: {
        reason: "sso_provider_mismatch",
        provider: state.provider,
        authProvider: policy.auth_provider
      }
    });
    return loginRedirect(request, { error: "oauth_invalid_account" });
  }

  const mfaRequired = await isMfaRequiredForLogin({
    tenant_id: user.tenant_id,
    role_name: user.role_name
  });
  const authProvider = `${state.provider}_oauth`;
  if (mfaRequired && (await hasActiveMfaFactor(user))) {
    const challenge = await createMfaChallenge(user, {
      authProvider: `${authProvider}_mfa`
    });
    await recordAuditLog({
      tenantId: user.tenant_id,
      actorUserId: user.id,
      action: "auth_oauth_login_mfa_challenge_created",
      entityType: "auth_mfa_challenge",
      data: {
        provider: state.provider,
        emailDomain: emailDomain(profile.email)
      }
    });
    await setOAuthMfaChallengeCookie(challenge.challengeToken);
    return loginRedirect(request, {
      mfa: "required",
      returnTo: state.returnTo
    });
  }

  const mfaEnrollmentRequired = mfaRequired;
  const sessionAuthProvider = mfaEnrollmentRequired
    ? `${authProvider}_mfa_enrollment_required`
    : authProvider;
  await createSession(user.id, {
    authProvider: sessionAuthProvider,
    requestHeaders: request.headers
  });
  await recordAuditLog({
    tenantId: user.tenant_id,
    actorUserId: user.id,
    action: "auth_oauth_login_success",
    entityType: "auth_session",
    data: {
      provider: state.provider,
      providerAccountId: profile.providerAccountId,
      authProvider: sessionAuthProvider,
      mfaEnrollmentRequired,
      mfaSatisfied: false
    }
  });

  return appRedirect(request, state.returnTo);
}
