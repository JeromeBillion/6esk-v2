import { getSessionUser, type SessionUser } from "@/server/auth/session";
import { isInternalStaff } from "@/server/auth/roles";
import { hasPrivilegedMfaSession } from "@/server/auth/privileged-access";

type BackofficeAuthResult =
  | {
      ok: true;
      user: SessionUser;
    }
  | {
      ok: false;
      response: Response;
    };

export async function requireBackofficeStaff(): Promise<BackofficeAuthResult> {
  const user = await getSessionUser();
  if (!isInternalStaff(user)) {
    return {
      ok: false,
      response: Response.json({ error: "Forbidden. 6esk Staff only." }, { status: 403 })
    };
  }
  return { ok: true, user: user as SessionUser };
}

export async function requireBackofficeSensitiveAccess(): Promise<BackofficeAuthResult> {
  const auth = await requireBackofficeStaff();
  if (!auth.ok) return auth;

  if (!hasPrivilegedMfaSession(auth.user)) {
    return {
      ok: false,
      response: Response.json(
        { error: "MFA is required for sensitive 6esk Work actions." },
        { status: 403 }
      )
    };
  }

  return auth;
}
