import { db } from "@/server/db";
import {
  isEmailAllowedByPolicy,
  resolveTenantSecurityPolicyByEmail,
  type TenantSecurityPolicy
} from "@/server/auth/tenant-security-policy";

export type BetterAuthBridgeProvider = {
  providerId: string;
  accountId: string;
  scopes: string[];
};

export type BetterAuthBridgeUser = {
  id: string;
  email: string;
  is_active: boolean;
  tenant_key: string;
  workspace_key: string;
  role_name: string | null;
};

export type BetterAuthBridgeResolution =
  | {
      ok: true;
      policy: TenantSecurityPolicy;
      user: BetterAuthBridgeUser;
    }
  | {
      ok: false;
      status: 403;
      code:
        | "tenant_policy_not_found"
        | "auth_provider_not_allowed"
        | "email_domain_not_allowed"
        | "app_user_not_found"
        | "app_user_inactive";
      message: string;
    };

const BRIDGE_AUTH_PROVIDERS = new Set(["better_auth", "oidc_broker"]);

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function splitScopes(value: string | null | undefined) {
  return (value ?? "")
    .split(/\s+/)
    .map((scope) => scope.trim())
    .filter(Boolean);
}

export function sanitizeBetterAuthNextPath(value: string | null | undefined) {
  const fallback = "/tickets";
  const candidate = value?.trim();
  if (!candidate) return fallback;
  if (!candidate.startsWith("/") || candidate.startsWith("//")) return fallback;
  try {
    const parsed = new URL(candidate, "https://app.local");
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}

export async function resolveBetterAuthBridgeUser(email: string): Promise<BetterAuthBridgeResolution> {
  const normalizedEmail = normalizeEmail(email);
  const policy = await resolveTenantSecurityPolicyByEmail(normalizedEmail);

  if (!policy) {
    return {
      ok: false,
      status: 403,
      code: "tenant_policy_not_found",
      message: "No tenant login policy matches this email domain."
    };
  }

  if (!BRIDGE_AUTH_PROVIDERS.has(policy.auth_provider)) {
    return {
      ok: false,
      status: 403,
      code: "auth_provider_not_allowed",
      message: "This tenant is not configured for federated sign-in."
    };
  }

  if (!isEmailAllowedByPolicy(normalizedEmail, policy)) {
    return {
      ok: false,
      status: 403,
      code: "email_domain_not_allowed",
      message: "This email domain is not allowed for the tenant."
    };
  }

  const result = await db.query<BetterAuthBridgeUser>(
    `SELECT u.id,
            u.email,
            u.is_active,
            u.tenant_key,
            u.workspace_key,
            r.name AS role_name
     FROM users u
     LEFT JOIN roles r ON r.id = u.role_id
     WHERE u.tenant_key = $1
       AND u.workspace_key = $2
       AND lower(u.email) = $3
     LIMIT 1`,
    [policy.tenant_key, policy.workspace_key, normalizedEmail]
  );
  const user = result.rows[0];
  if (!user) {
    return {
      ok: false,
      status: 403,
      code: "app_user_not_found",
      message: "No active app user is provisioned for this federated identity."
    };
  }
  if (!user.is_active) {
    return {
      ok: false,
      status: 403,
      code: "app_user_inactive",
      message: "The app user for this federated identity is inactive."
    };
  }

  return {
    ok: true,
    policy,
    user
  };
}

export async function lookupBetterAuthProviderAccount(betterAuthUserId: string): Promise<BetterAuthBridgeProvider | null> {
  const result = await db.query<{
    provider_id: string;
    account_id: string;
    scope: string | null;
  }>(
    `SELECT provider_id, account_id, scope
     FROM better_auth_accounts
     WHERE user_id = $1
     ORDER BY updated_at DESC, created_at DESC
     LIMIT 1`,
    [betterAuthUserId]
  );
  const account = result.rows[0];
  if (!account) return null;
  return {
    providerId: account.provider_id,
    accountId: account.account_id,
    scopes: splitScopes(account.scope)
  };
}

export async function upsertAuthIdentityAccount({
  user,
  provider,
  betterAuthUserId,
  betterAuthSessionId,
  email
}: {
  user: BetterAuthBridgeUser;
  provider: BetterAuthBridgeProvider | null;
  betterAuthUserId: string;
  betterAuthSessionId: string | null;
  email: string;
}) {
  const providerId = provider?.providerId ?? "better_auth";
  const providerAccountId = provider?.accountId ?? betterAuthUserId;
  const scopes = provider?.scopes ?? [];
  const metadata = {
    source: "better_auth_bridge",
    betterAuthUserId,
    betterAuthSessionId
  };

  await db.query(
    `INSERT INTO auth_identity_accounts (
       tenant_key,
       workspace_key,
       user_id,
       provider,
       provider_account_id,
       provider_email,
       scopes,
       metadata
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (tenant_key, provider, provider_account_id)
     DO UPDATE SET workspace_key = EXCLUDED.workspace_key,
                   user_id = EXCLUDED.user_id,
                   provider_email = EXCLUDED.provider_email,
                   scopes = EXCLUDED.scopes,
                   metadata = EXCLUDED.metadata,
                   updated_at = now()`,
    [
      user.tenant_key,
      user.workspace_key,
      user.id,
      providerId,
      providerAccountId,
      normalizeEmail(email),
      scopes,
      metadata
    ]
  );

  return {
    providerId,
    providerAccountId
  };
}
