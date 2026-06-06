import { db } from "@/server/db";
import { resolveTenantScope, type TenantScopeInput } from "@/server/tenant-context";

export type TenantSecurityPolicy = {
  tenant_key: string;
  workspace_key: string;
  allowed_login_domains: string[];
  enforce_sso: boolean;
  require_mfa_for_admins: boolean;
  session_ttl_days: number;
  auth_provider: "password" | "better_auth" | "oidc_broker" | string;
  oidc_issuer: string | null;
};

export type TenantSecurityPolicyUpdate = {
  allowedLoginDomains: string[];
  enforceSso: boolean;
  requireMfaForAdmins: boolean;
  sessionTtlDays: number;
  authProvider: "password" | "better_auth" | "oidc_broker";
  oidcIssuer?: string | null;
};

function normalizeDomain(domain: string) {
  return domain.trim().toLowerCase().replace(/^@+/, "");
}

function isValidLoginDomain(domain: string) {
  return /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain);
}

export function normalizeLoginDomains(domains: string[]) {
  const normalized = Array.from(
    new Set(
      domains
        .map(normalizeDomain)
        .filter(Boolean)
    )
  );
  const invalid = normalized.filter((domain) => !isValidLoginDomain(domain));
  if (invalid.length > 0) {
    throw new Error(`Invalid login domain: ${invalid[0]}`);
  }
  return normalized;
}

function normalizeOidcIssuer(value?: string | null) {
  const raw = value?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (!["https:", "http:"].includes(url.protocol)) return null;
    url.hash = "";
    url.search = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function defaultTenantSecurityPolicy(scopeInput: TenantScopeInput): TenantSecurityPolicy {
  const scope = resolveTenantScope(scopeInput);
  return {
    tenant_key: scope.tenantKey,
    workspace_key: scope.workspaceKey,
    allowed_login_domains: [],
    enforce_sso: false,
    require_mfa_for_admins: true,
    session_ttl_days: 14,
    auth_provider: "password",
    oidc_issuer: null
  };
}

export function domainFromEmail(email: string) {
  const normalized = email.trim().toLowerCase();
  const at = normalized.lastIndexOf("@");
  if (at <= 0 || at === normalized.length - 1) return null;
  return normalizeDomain(normalized.slice(at + 1));
}

export function isEmailAllowedByPolicy(email: string, policy: Pick<TenantSecurityPolicy, "allowed_login_domains">) {
  const domain = domainFromEmail(email);
  if (!domain) return false;
  const allowed = policy.allowed_login_domains.map(normalizeDomain).filter(Boolean);
  return allowed.length === 0 ? false : allowed.includes(domain);
}

export async function getTenantSecurityPolicy(scopeInput: TenantScopeInput) {
  const scope = resolveTenantScope(scopeInput);
  const result = await db.query<TenantSecurityPolicy>(
    `SELECT tenant_key,
            workspace_key,
            allowed_login_domains,
            enforce_sso,
            require_mfa_for_admins,
            session_ttl_days,
            auth_provider,
            oidc_issuer
     FROM tenant_security_policies
     WHERE tenant_key = $1
       AND workspace_key = $2
     LIMIT 1`,
    [scope.tenantKey, scope.workspaceKey]
  );

  return result.rows[0] ?? null;
}

export async function getTenantSecurityPolicyOrDefault(scopeInput: TenantScopeInput) {
  return (await getTenantSecurityPolicy(scopeInput)) ?? defaultTenantSecurityPolicy(scopeInput);
}

export async function upsertTenantSecurityPolicy(
  scopeInput: TenantScopeInput,
  input: TenantSecurityPolicyUpdate
) {
  const scope = resolveTenantScope(scopeInput);
  const allowedDomains = normalizeLoginDomains(input.allowedLoginDomains).slice(0, 50);
  const authProvider = input.authProvider;
  const oidcIssuer = authProvider === "oidc_broker" ? normalizeOidcIssuer(input.oidcIssuer) : null;
  const sessionTtlDays = Math.min(Math.max(Math.trunc(input.sessionTtlDays), 1), 90);

  if (input.enforceSso && authProvider === "password") {
    throw new Error("SSO enforcement requires Better Auth or an OIDC broker.");
  }
  if (input.enforceSso && allowedDomains.length === 0) {
    throw new Error("SSO enforcement requires at least one allowed login domain.");
  }
  if (authProvider === "oidc_broker" && !oidcIssuer) {
    throw new Error("OIDC broker mode requires a valid issuer URL.");
  }

  const result = await db.query<TenantSecurityPolicy>(
    `INSERT INTO tenant_security_policies (
       tenant_key,
       workspace_key,
       allowed_login_domains,
       enforce_sso,
       require_mfa_for_admins,
       session_ttl_days,
       auth_provider,
       oidc_issuer
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (tenant_key, workspace_key) DO UPDATE SET
       allowed_login_domains = EXCLUDED.allowed_login_domains,
       enforce_sso = EXCLUDED.enforce_sso,
       require_mfa_for_admins = EXCLUDED.require_mfa_for_admins,
       session_ttl_days = EXCLUDED.session_ttl_days,
       auth_provider = EXCLUDED.auth_provider,
       oidc_issuer = EXCLUDED.oidc_issuer,
       updated_at = now()
     RETURNING tenant_key,
               workspace_key,
               allowed_login_domains,
               enforce_sso,
               require_mfa_for_admins,
               session_ttl_days,
               auth_provider,
               oidc_issuer`,
    [
      scope.tenantKey,
      scope.workspaceKey,
      allowedDomains,
      input.enforceSso,
      input.requireMfaForAdmins,
      sessionTtlDays,
      authProvider,
      oidcIssuer
    ]
  );

  return result.rows[0];
}

export async function resolveTenantSecurityPolicyByEmail(email: string) {
  const domain = domainFromEmail(email);
  if (!domain) return null;

  const result = await db.query<TenantSecurityPolicy>(
    `SELECT tenant_key,
            workspace_key,
            allowed_login_domains,
            enforce_sso,
            require_mfa_for_admins,
            session_ttl_days,
            auth_provider,
            oidc_issuer
     FROM tenant_security_policies
     WHERE EXISTS (
       SELECT 1
       FROM unnest(allowed_login_domains) AS allowed(domain)
       WHERE regexp_replace(lower(trim(allowed.domain)), '^@+', '') = $1
     )
     ORDER BY tenant_key ASC, workspace_key ASC
     LIMIT 2`,
    [domain]
  );

  if (result.rows.length !== 1) {
    return null;
  }

  return result.rows[0];
}
