import { canManageBilling, isLeadAdmin } from "@/server/auth/roles";
import {
  assertSensitiveSessionMfa,
  sensitiveSessionErrorResponse
} from "@/server/auth/sensitive-session";
import { getSessionUser, type SessionUser } from "@/server/auth/session";
import {
  isTenantIngressScopeError,
  tenantScopeFromMachineRequestAsync,
  tenantScopeFromUser,
  type TenantScope
} from "@/server/tenant-context";

export type LeadAdminAccess =
  | {
      ok: true;
      user: SessionUser;
      scope: TenantScope;
    }
  | {
      ok: false;
      response: Response;
    };

export type BillingAdminAccess =
  | {
      ok: true;
      user: SessionUser;
      scope: TenantScope;
    }
  | {
      ok: false;
      response: Response;
    };

export type LeadAdminOrMachineAccess =
  | {
      ok: true;
      user: SessionUser | null;
      scope: TenantScope;
      authMode: "lead_admin" | "machine";
    }
  | {
      ok: false;
      response: Response;
    };

function authProviderForGuard(user: SessionUser) {
  if (user.session_auth_provider !== undefined) {
    return user.session_auth_provider;
  }
  return process.env.NODE_ENV === "test" ? "password_mfa" : null;
}

function configuredSecretFromEnv(envNames: string[]) {
  for (const envName of envNames) {
    const secret = process.env[envName]?.trim();
    if (secret) return secret;
  }
  return "";
}

function matchesConfiguredSecret(request: Request, envNames: string[]) {
  const configuredSecret = configuredSecretFromEnv(envNames);
  const provided = request.headers.get("x-6esk-secret")?.trim() ?? "";
  return Boolean(configuredSecret && provided === configuredSecret);
}

export async function requireLeadAdminAccess({
  requireMfa = false
}: {
  requireMfa?: boolean;
} = {}): Promise<LeadAdminAccess> {
  const user = await getSessionUser();
  if (!user || !isLeadAdmin(user)) {
    return {
      ok: false,
      response: Response.json({ error: "Forbidden" }, { status: 403 })
    };
  }

  if (requireMfa) {
    try {
      await assertSensitiveSessionMfa({
        user,
        authProvider: authProviderForGuard(user)
      });
    } catch (error) {
      const response = sensitiveSessionErrorResponse(error);
      if (response) return { ok: false, response };
      throw error;
    }
  }

  return {
    ok: true,
    user,
    scope: tenantScopeFromUser(user)
  };
}

export async function requireBillingAdminAccess({
  requireMfa = true
}: {
  requireMfa?: boolean;
} = {}): Promise<BillingAdminAccess> {
  const user = await getSessionUser();
  if (!user || !canManageBilling(user)) {
    return {
      ok: false,
      response: Response.json({ error: "Forbidden" }, { status: 403 })
    };
  }

  if (requireMfa) {
    try {
      await assertSensitiveSessionMfa({
        user,
        authProvider: authProviderForGuard(user)
      });
    } catch (error) {
      const response = sensitiveSessionErrorResponse(error);
      if (response) return { ok: false, response };
      throw error;
    }
  }

  return {
    ok: true,
    user,
    scope: tenantScopeFromUser(user)
  };
}

export async function requireLeadAdminOrMachineAccess(
  request: Request,
  {
    requireMfaForUser = true,
    secretEnvNames
  }: {
    requireMfaForUser?: boolean;
    secretEnvNames: string[];
  }
): Promise<LeadAdminOrMachineAccess> {
  const user = await getSessionUser();
  if (user) {
    if (!isLeadAdmin(user)) {
      return {
        ok: false,
        response: Response.json({ error: "Forbidden" }, { status: 403 })
      };
    }
    if (requireMfaForUser) {
      try {
        await assertSensitiveSessionMfa({
          user,
          authProvider: authProviderForGuard(user)
        });
      } catch (error) {
        const response = sensitiveSessionErrorResponse(error);
        if (response) return { ok: false, response };
        throw error;
      }
    }
    return {
      ok: true,
      user,
      scope: tenantScopeFromUser(user),
      authMode: "lead_admin"
    };
  }

  if (!matchesConfiguredSecret(request, secretEnvNames)) {
    return {
      ok: false,
      response: Response.json({ error: "Unauthorized" }, { status: 401 })
    };
  }

  try {
    return {
      ok: true,
      user: null,
      scope: await tenantScopeFromMachineRequestAsync(request),
      authMode: "machine"
    };
  } catch (error) {
    if (isTenantIngressScopeError(error)) {
      return {
        ok: false,
        response: Response.json({ error: error.message, code: error.code }, { status: error.status })
      };
    }
    throw error;
  }
}
