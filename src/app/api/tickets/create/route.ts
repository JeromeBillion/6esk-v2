import { getSessionUser } from "@/server/auth/session";
import { canManageTickets } from "@/server/auth/roles";
import { DEFAULT_TENANT_ID } from "@/server/tenant/types";
import {
  isTenantIngressVerificationError,
  resolveTenantIngressRequestScope
} from "@/server/tenant-ingress-secrets";
import {
  integrationError,
  validateIntegrationApiVersion
} from "@/server/api-contract";
import {
  createTicketSchema,
  processCreateTicket
} from "@/server/tickets/create-flow";

export async function POST(request: Request) {
  const versionError = validateIntegrationApiVersion(request);
  if (versionError) {
    return versionError;
  }

  const sharedSecret = process.env.INBOUND_SHARED_SECRET ?? "";
  const sessionUser = await getSessionUser();

  if (sessionUser && !canManageTickets(sessionUser)) {
    return integrationError(request, {
      status: 403,
      code: "forbidden",
      message: "Forbidden"
    });
  }

  let machineIngressTenantId: string | null = null;
  if (!sessionUser) {
    try {
      const scope = await resolveTenantIngressRequestScope(request, {
        fallbackGlobalSecret: sharedSecret,
        fallbackTenantId: DEFAULT_TENANT_ID
      });
      machineIngressTenantId = scope.tenantId;
    } catch (error) {
      if (isTenantIngressVerificationError(error)) {
        const unauthorized = error.status === 401;
        return integrationError(request, {
          status: error.status,
          code: unauthorized ? "unauthorized" : error.code,
          message: unauthorized ? "Unauthorized" : error.message
        });
      }
      throw error;
    }
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return integrationError(request, {
      status: 400,
      code: "invalid_json",
      message: "Invalid JSON body"
    });
  }

  const parsed = createTicketSchema.safeParse(payload);
  if (!parsed.success) {
    return integrationError(request, {
      status: 400,
      code: "invalid_payload",
      message: "Invalid payload",
      details: parsed.error.flatten()
    });
  }

  const tenantId = sessionUser?.tenant_id ?? machineIngressTenantId;
  if (!tenantId) {
    return integrationError(request, {
      status: 401,
      code: "tenant_required",
      message: "Tenant context is required"
    });
  }
  return processCreateTicket({
    request,
    sessionUser,
    tenantId,
    data: parsed.data
  });
}
