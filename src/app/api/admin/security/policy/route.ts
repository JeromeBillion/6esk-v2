import { z } from "zod";
import { recordAuditLog } from "@/server/audit";
import { isLeadAdmin } from "@/server/auth/roles";
import {
  assertSensitiveSessionMfa,
  sensitiveSessionErrorResponse
} from "@/server/auth/sensitive-session";
import { getSessionContext } from "@/server/auth/session";
import {
  getTenantSecurityPolicyOrDefault,
  upsertTenantSecurityPolicy,
  type TenantSecurityPolicy
} from "@/server/auth/tenant-security-policy";
import { tenantScopeFromUser } from "@/server/tenant-context";

const policySchema = z.object({
  allowedLoginDomains: z.array(z.string().min(1)).max(50),
  enforceSso: z.boolean(),
  requireMfaForAdmins: z.boolean(),
  sessionTtlDays: z.number().int().min(1).max(90),
  authProvider: z.enum(["password", "better_auth", "oidc_broker"]),
  oidcIssuer: z.string().trim().max(500).nullable().optional()
});

function serializePolicy(policy: TenantSecurityPolicy) {
  return {
    tenantKey: policy.tenant_key,
    workspaceKey: policy.workspace_key,
    allowedLoginDomains: policy.allowed_login_domains,
    enforceSso: policy.enforce_sso,
    requireMfaForAdmins: policy.require_mfa_for_admins,
    sessionTtlDays: policy.session_ttl_days,
    authProvider: policy.auth_provider,
    oidcIssuer: policy.oidc_issuer
  };
}

async function requireLeadAdmin({ requireMfa = false }: { requireMfa?: boolean } = {}) {
  const context = await getSessionContext();
  const user = context?.user ?? null;
  if (!isLeadAdmin(user)) {
    return { user: null, response: Response.json({ error: "Forbidden" }, { status: 403 }) };
  }
  if (requireMfa) {
    try {
      await assertSensitiveSessionMfa({ user, authProvider: context?.authProvider ?? null });
    } catch (error) {
      const response = sensitiveSessionErrorResponse(error);
      if (response) return { user: null, response };
      throw error;
    }
  }
  return { user, response: null };
}

export async function GET() {
  const { user, response } = await requireLeadAdmin();
  if (response) return response;

  const scope = tenantScopeFromUser(user);
  const policy = await getTenantSecurityPolicyOrDefault(scope);
  return Response.json({ policy: serializePolicy(policy) });
}

export async function POST(request: Request) {
  const { user, response } = await requireLeadAdmin({ requireMfa: true });
  if (response) return response;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = policySchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json({ error: "Invalid payload" }, { status: 400 });
  }

  const scope = tenantScopeFromUser(user);
  try {
    const policy = await upsertTenantSecurityPolicy(scope, parsed.data);
    await recordAuditLog({
      tenantKey: scope.tenantKey,
      workspaceKey: scope.workspaceKey,
      actorUserId: user?.id ?? null,
      action: "tenant_security_policy_updated",
      entityType: "tenant_security_policy",
      entityId: `${scope.tenantKey}:${scope.workspaceKey}`,
      data: {
        allowedLoginDomains: policy.allowed_login_domains,
        enforceSso: policy.enforce_sso,
        requireMfaForAdmins: policy.require_mfa_for_admins,
        sessionTtlDays: policy.session_ttl_days,
        authProvider: policy.auth_provider,
        oidcIssuerConfigured: Boolean(policy.oidc_issuer)
      }
    });

    return Response.json({ status: "ok", policy: serializePolicy(policy) });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Invalid tenant security policy" },
      { status: 400 }
    );
  }
}
