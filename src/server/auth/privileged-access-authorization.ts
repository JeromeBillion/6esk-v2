import { recordAuditLog } from "@/server/audit";
import {
  getActivePrivilegedAccessGrantForSubject,
  type PrivilegedAccessGrant,
  type PrivilegedAccessType
} from "@/server/auth/privileged-access";
import { isInternalSupportUser, isLeadAdmin } from "@/server/auth/roles";
import {
  assertSensitiveSessionMfa,
  sensitiveSessionErrorResponse
} from "@/server/auth/sensitive-session";
import type { SessionUser } from "@/server/auth/session";
import { tenantScopeFromUser, type TenantScope } from "@/server/tenant-context";

export const PRIVILEGED_ACCESS_GRANT_HEADER = "x-6esk-privileged-access-grant";

export type PrivilegedAccessResolution = {
  scope: TenantScope;
  mode: "tenant_admin" | "privileged_access";
  actorUserId: string | null;
  grant: PrivilegedAccessGrant | null;
};

export class PrivilegedAccessAuthorizationError extends Error {
  status: number;

  constructor(message: string, status = 403) {
    super(message);
    this.name = "PrivilegedAccessAuthorizationError";
    this.status = status;
  }
}

function readGrantId(request: Request) {
  const headerGrant = request.headers.get(PRIVILEGED_ACCESS_GRANT_HEADER)?.trim();
  if (headerGrant) return headerGrant;
  const queryGrant = new URL(request.url).searchParams.get("privilegedAccessGrant")?.trim();
  return queryGrant || null;
}

export function privilegedAccessErrorResponse(error: unknown) {
  if (error instanceof PrivilegedAccessAuthorizationError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  const sensitiveResponse = sensitiveSessionErrorResponse(error);
  if (sensitiveResponse) return sensitiveResponse;
  return null;
}

export async function resolveTenantDataAccess(
  request: Request,
  user: SessionUser | null,
  options: {
    operation: string;
    accessTypes?: PrivilegedAccessType[];
    authProvider?: string | null;
  }
): Promise<PrivilegedAccessResolution> {
  if (options.authProvider !== undefined) {
    await assertSensitiveSessionMfa({ user, authProvider: options.authProvider });
  }

  if (isLeadAdmin(user)) {
    return {
      scope: tenantScopeFromUser(user),
      mode: "tenant_admin",
      actorUserId: user?.id ?? null,
      grant: null
    };
  }

  if (!isInternalSupportUser(user)) {
    throw new PrivilegedAccessAuthorizationError("Forbidden", 403);
  }

  const grantId = readGrantId(request);
  if (!grantId) {
    throw new PrivilegedAccessAuthorizationError("Active privileged access grant is required.", 403);
  }

  const grant = await getActivePrivilegedAccessGrantForSubject({
    grantId,
    subjectEmail: user?.email ?? "",
    accessTypes: options.accessTypes
  });
  if (!grant) {
    throw new PrivilegedAccessAuthorizationError("Active privileged access grant was not found.", 403);
  }

  await recordAuditLog({
    tenantKey: grant.tenant_key,
    workspaceKey: grant.workspace_key,
    actorUserId: null,
    action: "privileged_access_used",
    entityType: "privileged_access_grant",
    entityId: grant.id,
    data: {
      operation: options.operation,
      accessType: grant.access_type,
      subjectEmail: user?.email ?? null,
      subjectUserId: user?.id ?? null,
      reference: grant.reference,
      expiresAt: grant.expires_at
    }
  });

  return {
    scope: {
      tenantKey: grant.tenant_key,
      workspaceKey: grant.workspace_key
    },
    mode: "privileged_access",
    actorUserId: null,
    grant
  };
}
