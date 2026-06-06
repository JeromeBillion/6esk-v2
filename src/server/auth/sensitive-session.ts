import { isMfaRequiredForLogin } from "@/server/auth/mfa";
import { isPrivilegedRole } from "@/server/auth/roles";
import type { SessionContext, SessionUser } from "@/server/auth/session";

export class SensitiveSessionAuthorizationError extends Error {
  status: number;
  code: string;

  constructor(message: string, status = 403, code = "mfa_required") {
    super(message);
    this.name = "SensitiveSessionAuthorizationError";
    this.status = status;
    this.code = code;
  }
}

export function isMfaSatisfiedAuthProvider(authProvider: string | null | undefined) {
  const provider = authProvider?.trim().toLowerCase() ?? "";
  return provider === "password_mfa" || provider === "better_auth_mfa";
}

export function isMfaEnrollmentRequiredAuthProvider(authProvider: string | null | undefined) {
  return authProvider?.trim().toLowerCase().endsWith("_mfa_enrollment_required") === true;
}

export async function assertSensitiveSessionMfa({
  user,
  authProvider
}: {
  user: SessionUser | null;
  authProvider: string | null | undefined;
}) {
  if (!user || !isPrivilegedRole(user)) return;
  if (isMfaSatisfiedAuthProvider(authProvider)) return;
  if (!(await isMfaRequiredForLogin(user))) return;

  throw new SensitiveSessionAuthorizationError(
    "MFA verification is required before privileged operations.",
    403,
    isMfaEnrollmentRequiredAuthProvider(authProvider) ? "mfa_enrollment_required" : "mfa_required"
  );
}

export function sensitiveSessionErrorResponse(error: unknown) {
  if (error instanceof SensitiveSessionAuthorizationError) {
    return Response.json({ error: error.message, code: error.code }, { status: error.status });
  }
  return null;
}

export async function assertSensitiveContextMfa(context: SessionContext | null) {
  if (!context) {
    throw new SensitiveSessionAuthorizationError("Forbidden", 403, "forbidden");
  }
  await assertSensitiveSessionMfa({
    user: context.user,
    authProvider: context.authProvider
  });
}
