import { getAgentFromRequest } from "@/server/agents/auth";
import { hasMailboxScope } from "@/server/agents/scopes";
import { getTicketById } from "@/server/tickets";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ ticketId: string }> }
) {
  const integration = await getAgentFromRequest(_request);
  if (!integration) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (integration.status !== "active") {
    return Response.json({ error: "Integration paused" }, { status: 403 });
  }

  const { ticketId } = await params;
  const ticket = await getTicketById(ticketId);
  if (!ticket) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  if (!hasMailboxScope(integration, ticket.mailbox_id)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  return Response.json({ ticket });
}
