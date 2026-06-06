import { getAgentFromRequest } from "@/server/agents/auth";
import { hasMailboxScope } from "@/server/agents/scopes";
import { getTicketById } from "@/server/tickets";
import { getTicketCallOptions } from "@/server/calls/service";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ ticketId: string }> }
) {
  const integration = await getAgentFromRequest(request);
  if (!integration) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (integration.status !== "active") {
    return Response.json({ error: "Integration paused" }, { status: 403 });
  }

  const { ticketId } = await params;
  const ticket = await getTicketById(ticketId, integration.tenant_id);
  if (!ticket) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  if (!hasMailboxScope(integration, ticket.mailbox_id)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const options = await getTicketCallOptions(ticketId, integration.tenant_id);
  if (!options) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  return Response.json(options);
}
