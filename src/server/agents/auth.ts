import { timingSafeEqual } from "crypto";
import { getActiveAgentIntegration, getAgentIntegrationById } from "@/server/agents/integrations";
import {
  isTenantIngressScopeError,
  resolveTenantScope,
  shouldRequireTenantIngressScope,
  shouldRequireTenantIngressSignature,
  tenantScopeFromMachineRequestAsync,
  type TenantScope
} from "@/server/tenant-context";
import type { AgentIntegration } from "@/server/agents/integrations";

function parseBearer(authHeader: string | null) {
  if (!authHeader) return null;
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}

function secureCompare(a: string, b: string) {
  const aBuffer = Buffer.from(a);
  const bBuffer = Buffer.from(b);
  if (aBuffer.length !== bBuffer.length) {
    return false;
  }
  return timingSafeEqual(aBuffer, bBuffer);
}

function hasStrictTenantIngressSignal(request: Request) {
  return Boolean(
    request.headers.get("x-6esk-workspace")?.trim() ||
      request.headers.get("x-6esk-tenant-signature")?.trim() ||
      request.headers.get("x-6esk-tenant-timestamp")?.trim()
  );
}

function resolveAgentRequestScope(request: Request) {
  if (
    shouldRequireTenantIngressScope() ||
    shouldRequireTenantIngressSignature() ||
    hasStrictTenantIngressSignal(request)
  ) {
    return tenantScopeFromMachineRequestAsync(request);
  }

  const tenantHeader = request.headers.get("x-6esk-tenant")?.trim();
  if (tenantHeader) {
    return Promise.resolve(resolveTenantScope({ tenantKey: tenantHeader }));
  }

  return Promise.resolve<TenantScope | undefined>(undefined);
}

export type AuthenticatedAgentIntegration = AgentIntegration & {
  workspace_key: string;
  tenant_scope: TenantScope;
};

export function agentScopeFromIntegration(integration: Pick<AgentIntegration, "tenant_key" | "workspace_key">) {
  return resolveTenantScope({
    tenantKey: integration.tenant_key,
    workspaceKey: integration.workspace_key
  });
}

export function agentIngressErrorResponse(error: unknown) {
  if (!isTenantIngressScopeError(error)) {
    return null;
  }
  return Response.json(
    {
      error: error.message,
      code: error.code
    },
    { status: error.status }
  );
}

export async function getAgentFromRequest(request: Request): Promise<AuthenticatedAgentIntegration | null> {
  const agentId = request.headers.get("x-6esk-agent-id");
  const agentKey =
    request.headers.get("x-6esk-agent-key") ??
    parseBearer(request.headers.get("authorization"));

  if (!agentKey) {
    return null;
  }

  const scope = await resolveAgentRequestScope(request);
  const integration = agentId
    ? await getAgentIntegrationById(agentId, scope)
    : await getActiveAgentIntegration(scope);

  if (!integration) {
    return null;
  }

  if (!secureCompare(agentKey, integration.shared_secret)) {
    return null;
  }

  const authenticatedScope = resolveTenantScope({
    tenantKey: integration.tenant_key,
    workspaceKey: scope?.workspaceKey
  });

  return {
    ...integration,
    workspace_key: authenticatedScope.workspaceKey,
    tenant_scope: authenticatedScope
  };
}
