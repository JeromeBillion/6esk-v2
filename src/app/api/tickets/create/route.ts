import { getSessionUser } from "@/server/auth/session";
import { canManageTickets } from "@/server/auth/roles";
import { DEFAULT_TENANT_ID } from "@/server/tenant/types";
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
  const provided = request.headers.get("x-6esk-secret");
  const sessionUser = await getSessionUser();

  if (sessionUser && !canManageTickets(sessionUser)) {
    return integrationError(request, {
      status: 403,
      code: "forbidden",
      message: "Forbidden"
    });
  }

  if (!sessionUser && (!sharedSecret || provided !== sharedSecret)) {
    return integrationError(request, {
      status: 401,
      code: "unauthorized",
      message: "Unauthorized"
    });
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

  const tenantId = sessionUser?.tenant_id ?? DEFAULT_TENANT_ID;
  return processCreateTicket({
    request,
    sessionUser,
    tenantId,
    data: parsed.data
  });
}