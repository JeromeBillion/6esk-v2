import type { SessionUser } from "@/server/auth/session";
import { isLeadAdmin } from "@/server/auth/roles";
import { sessionTenantId } from "@/server/auth/tenant-session";
import {
  isTenantIngressVerificationError,
  resolveTenantIngressRequestScope,
  shouldRequireTenantIngressSigningSecrets
} from "@/server/tenant-ingress-secrets";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type InboundAdminScope =
  | {
      ok: true;
      tenantId: string;
      actorUserId: string | null;
      authMode: "session" | "tenant_ingress_secret" | "global_shared_secret" | "shared_secret";
    }
  | {
      ok: false;
      response: Response;
    };

function readTenantHeader(request: Request) {
  return (
    request.headers.get("x-6esk-tenant-id")?.trim() ||
    request.headers.get("x-6esk-tenant")?.trim() ||
    null
  );
}

export async function resolveInboundAdminScope(
  request: Request,
  user: SessionUser | null
): Promise<InboundAdminScope> {
  if (isLeadAdmin(user)) {
    const tenantId = sessionTenantId(user);
    if (!tenantId) {
      return { ok: false, response: Response.json({ error: "Forbidden" }, { status: 403 }) };
    }
    return {
      ok: true,
      tenantId,
      actorUserId: user?.id ?? null,
      authMode: "session"
    };
  }

  if (shouldRequireTenantIngressSigningSecrets()) {
    try {
      const scope = await resolveTenantIngressRequestScope(request, {
        fallbackGlobalSecret: process.env.INBOUND_SHARED_SECRET,
        fallbackTenantId: readTenantHeader(request)
      });
      return {
        ok: true,
        tenantId: scope.tenantId,
        actorUserId: null,
        authMode: scope.authMode
      };
    } catch (error) {
      if (isTenantIngressVerificationError(error)) {
        return {
          ok: false,
          response: Response.json({ error: error.message, code: error.code }, { status: error.status })
        };
      }
      throw error;
    }
  }

  const sharedSecret = process.env.INBOUND_SHARED_SECRET ?? "";
  const provided = request.headers.get("x-6esk-secret")?.trim() ?? "";
  if (!sharedSecret || provided !== sharedSecret) {
    return { ok: false, response: Response.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  const tenantId = readTenantHeader(request);
  if (!tenantId) {
    return {
      ok: false,
      response: Response.json({ error: "Tenant header is required" }, { status: 400 })
    };
  }
  if (!UUID_RE.test(tenantId)) {
    return {
      ok: false,
      response: Response.json({ error: "Tenant header must be a UUID" }, { status: 400 })
    };
  }

  return {
    ok: true,
    tenantId,
    actorUserId: null,
    authMode: "shared_secret"
  };
}
