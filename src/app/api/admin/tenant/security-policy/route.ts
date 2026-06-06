import { z } from "zod";
import { getSessionUser } from "@/server/auth/session";
import { hasTenantAdminAccess } from "@/server/auth/roles";
import {
  getTenantSecurityPolicyOrDefault,
  upsertTenantSecurityPolicy
} from "@/server/auth/tenant-security-policy";
import { recordAuditLog } from "@/server/audit";
import { DEFAULT_WORKSPACE_KEY } from "@/server/workspace-modules";

const securityPolicySchema = z.object({
  allowedLoginDomains: z.array(z.string().min(1).max(253)).max(50).optional().default([]),
  enforceSso: z.boolean().optional().default(false),
  requireMfaForAdmins: z.boolean().optional().default(true),
  sessionTtlDays: z.number().int().min(1).max(90).optional().default(14),
  authProvider: z.enum(["password", "better_auth", "oidc_broker"]).optional().default("password"),
  oidcIssuer: z.string().url().optional().nullable()
});

function toResponsePolicy(policy: Awaited<ReturnType<typeof getTenantSecurityPolicyOrDefault>>) {
  return {
    tenantId: policy.tenant_id,
    workspaceKey: policy.workspace_key,
    allowedLoginDomains: policy.allowed_login_domains,
    enforceSso: policy.enforce_sso,
    requireMfaForAdmins: policy.require_mfa_for_admins,
    sessionTtlDays: policy.session_ttl_days,
    authProvider: policy.auth_provider,
    oidcIssuer: policy.oidc_issuer
  };
}

async function requireTenantAdmin() {
  const user = await getSessionUser();
  if (!user || !hasTenantAdminAccess(user) || !user.tenant_id) {
    return {
      ok: false as const,
      response: Response.json({ error: "Forbidden" }, { status: 403 })
    };
  }
  return {
    ok: true as const,
    user,
    scope: {
      tenantId: user.tenant_id,
      workspaceKey: DEFAULT_WORKSPACE_KEY
    }
  };
}

export async function GET() {
  const auth = await requireTenantAdmin();
  if (!auth.ok) return auth.response;

  const policy = await getTenantSecurityPolicyOrDefault(auth.scope);
  return Response.json({ policy: toResponsePolicy(policy) });
}

export async function PUT(request: Request) {
  const auth = await requireTenantAdmin();
  if (!auth.ok) return auth.response;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = securityPolicySchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json({ error: "Invalid payload", details: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const policy = await upsertTenantSecurityPolicy(auth.scope, parsed.data);
    await recordAuditLog({
      tenantId: auth.scope.tenantId,
      actorUserId: auth.user.id,
      action: "tenant_security_policy_updated",
      entityType: "tenant_security_policy",
      entityId: auth.scope.tenantId,
      data: {
        workspaceKey: auth.scope.workspaceKey,
        allowedLoginDomainCount: policy.allowed_login_domains.length,
        enforceSso: policy.enforce_sso,
        requireMfaForAdmins: policy.require_mfa_for_admins,
        sessionTtlDays: policy.session_ttl_days,
        authProvider: policy.auth_provider,
        oidcIssuerConfigured: Boolean(policy.oidc_issuer)
      }
    });
    return Response.json({ policy: toResponsePolicy(policy) });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 400 });
  }
}
