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

export async function GET(
  request: Request,
  { params }: { params: Promise<{ ticketId: string }> }
) {
  const user = await getSessionUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { ticketId } = await params;
  const ticket = await getTicketById(ticketId);
  if (!ticket) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  if (!isLeadAdmin(user) && ticket.assigned_user_id !== user.id) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  let customerId = ticket.customer_id;
  if (!customerId) {
    const requesterEmail = ticket.requester_email.startsWith("whatsapp:")
      ? null
      : ticket.requester_email;
    const requesterPhone = ticket.requester_email.startsWith("whatsapp:")
      ? ticket.requester_email.replace(/^whatsapp:/, "")
      : null;
    const customerResolution = await resolveOrCreateCustomerForInbound({
      inboundEmail: requesterEmail,
      inboundPhone: requesterPhone
    });
    customerId = customerResolution?.customerId ?? null;
    if (customerId) {
      await attachCustomerToTicket(ticketId, customerId);
    }
  }

  if (!customerId) {
    return Response.json({ customer: null, history: [], nextCursor: null });
  }

  const url = new URL(request.url);
  const limitParam = url.searchParams.get("limit");
  const cursorParam = url.searchParams.get("cursor");
  const limit = Math.min(Math.max(Number(limitParam ?? 30) || 30, 1), 100);

  const [customer, historyPage] = await Promise.all([
    getCustomerById(customerId),
    listCustomerHistory(customerId, {
      limit,
      cursor: cursorParam
    })
  ]);

  const identities = customer ? await listCustomerIdentities(customer.id) : [];

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
