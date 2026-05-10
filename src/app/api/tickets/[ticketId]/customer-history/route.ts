import { getSessionUser } from "@/server/auth/session";
import { isLeadAdmin } from "@/server/auth/roles";
import { getTicketById } from "@/server/tickets";
import {
  attachCustomerToTicket,
  getCustomerById,
  listCustomerIdentities,
  listCustomerHistory,
  resolveOrCreateCustomerForInbound
} from "@/server/customers";
import { DEFAULT_TENANT_ID } from "@/server/tenant/types";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ ticketId: string }> }
) {
  const user = await getSessionUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { ticketId } = await params;
  const tenantId = user.tenant_id ?? DEFAULT_TENANT_ID;
  const ticket = await getTicketById(ticketId, tenantId);
  if (!ticket) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  if (!isLeadAdmin(user) && ticket.assigned_user_id !== user.id) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  let customerId = ticket.customer_id;
  if (!customerId) {
    const requesterEmail =
      ticket.requester_email.startsWith("whatsapp:") ||
      ticket.requester_email.startsWith("voice:")
      ? null
      : ticket.requester_email;
    const requesterPhone = ticket.requester_email.startsWith("whatsapp:")
      ? ticket.requester_email.replace(/^whatsapp:/, "")
      : ticket.requester_email.startsWith("voice:")
        ? ticket.requester_email.replace(/^voice:/, "")
        : null;
    const customerResolution = await resolveOrCreateCustomerForInbound({
      tenantId,
      inboundEmail: requesterEmail,
      inboundPhone: requesterPhone
    });
    customerId = customerResolution?.customerId ?? null;
    if (customerId) {
      await attachCustomerToTicket(ticketId, customerId, tenantId);
    }
  }

  if (!customerId) {
    return Response.json({ customer: null, history: [], nextCursor: null });
  }

  const url = new URL(request.url);
  const limitParam = url.searchParams.get("limit");
  const cursorParam = url.searchParams.get("cursor");
  const parsedLimit = Number(limitParam ?? 30);
  const limit = Math.min(Math.max(Number.isFinite(parsedLimit) ? parsedLimit : 30, 1), 100);

  const [customer, historyPage] = await Promise.all([
    getCustomerById(customerId, tenantId),
    listCustomerHistory(customerId, tenantId, {
      limit,
      cursor: cursorParam
    })
  ]);

  const identities = customer ? await listCustomerIdentities(customer.id, tenantId) : [];

  return Response.json({
    customer: customer
      ? {
          ...customer,
          identities: identities.map((identity) => ({
            type: identity.identity_type,
            value: identity.identity_value,
            isPrimary: identity.is_primary
          }))
        }
      : null,
    history: historyPage.items,
    nextCursor: historyPage.nextCursor
  });
}
