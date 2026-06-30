import { getSessionUser, type SessionUser } from "@/server/auth/session";
import { isInternalStaff } from "@/server/auth/roles";
import { hasPrivilegedMfaSession } from "@/server/auth/privileged-access";
import {
  BACKOFFICE_ACCESS_EMAIL_HEADER,
  shouldRequireCloudflareAccess
} from "@6esk/auth/cloudflare-access";

type BackofficeAuthResult =
  | {
      ok: true;
      user: SessionUser;
    }
  | {
      ok: false;
      response: Response;
    };

function normalizeEmail(value: string | null | undefined) {
  return value?.trim().toLowerCase() || null;
}

export function isBackofficeAccessSessionBound(
  user: Pick<SessionUser, "email"> | null,
  requestHeaders?: Headers | null
) {
  if (!shouldRequireCloudflareAccess()) return true;
  const sessionEmail = normalizeEmail(user?.email);
  const accessEmail = normalizeEmail(requestHeaders?.get(BACKOFFICE_ACCESS_EMAIL_HEADER));
  return Boolean(sessionEmail && accessEmail && sessionEmail === accessEmail);
}

export async function requireBackofficeStaff(requestHeaders?: Headers | null): Promise<BackofficeAuthResult> {
  const user = await getSessionUser();
  if (!isInternalStaff(user)) {
    return {
      ok: false,
      response: Response.json({ error: "Forbidden. 6esk Staff only." }, { status: 403 })
    };
  }
  if (!isBackofficeAccessSessionBound(user, requestHeaders)) {
    return {
      ok: false,
      response: Response.json(
        { error: "Cloudflare Access identity must match the 6esk Work session." },
        { status: 403 }
      )
    };
  }
  return { ok: true, user: user as SessionUser };
}

export async function requireBackofficeSensitiveAccess(requestHeaders?: Headers | null): Promise<BackofficeAuthResult> {
  const auth = await requireBackofficeStaff(requestHeaders);
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
