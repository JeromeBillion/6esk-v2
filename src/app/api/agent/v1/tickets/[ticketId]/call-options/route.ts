import {
  agentIngressErrorResponse,
  agentScopeFromIntegration,
  getAgentFromRequest
} from "@/server/agents/auth";
import { hasMailboxScope } from "@/server/agents/scopes";
import { getTicketById } from "@/server/tickets";
import { getTicketCallOptions } from "@/server/calls/service";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ ticketId: string }> }
) {
  let integration;
  try {
    integration = await getAgentFromRequest(request);
  } catch (error) {
    const response = agentIngressErrorResponse(error);
    if (response) return response;
    throw error;
  }
  if (!integration) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (integration.status !== "active") {
    return Response.json({ error: "Integration paused" }, { status: 403 });
  }
  const scope = agentScopeFromIntegration(integration);

  const { ticketId } = await params;
  const ticket = await getTicketById(ticketId, scope);
  if (!ticket) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  if (!hasMailboxScope(integration, ticket.mailbox_id)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const options = await getTicketCallOptions(ticketId, scope);
  if (!options) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  return Response.json(options);
}
