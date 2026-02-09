import { z } from "zod";
import { getSessionUser } from "@/server/auth/session";
import { isLeadAdmin } from "@/server/auth/roles";
import { recordAuditLog } from "@/server/audit";
import { updateDraftStatus } from "@/server/agents/drafts";
import { getTicketById, recordTicketEvent } from "@/server/tickets";

const updateSchema = z.object({
  status: z.enum(["used", "dismissed"])
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ ticketId: string; draftId: string }> }
) {
  const user = await getSessionUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { ticketId, draftId } = await params;
  const ticket = await getTicketById(ticketId);
  if (!ticket) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const isAdmin = isLeadAdmin(user);
  if (!isAdmin && ticket.assigned_user_id !== user.id) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch (error) {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = updateSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json({ error: "Invalid payload" }, { status: 400 });
  }

  const updated = await updateDraftStatus({
    draftId,
    ticketId,
    status: parsed.data.status
  });

  if (!updated) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const eventType = parsed.data.status === "used" ? "ai_draft_used" : "ai_draft_dismissed";
  await recordTicketEvent({
    ticketId,
    eventType,
    actorUserId: user.id
  });
  await recordAuditLog({
    actorUserId: user.id,
    action: eventType,
    entityType: "agent_draft",
    entityId: draftId,
    data: { ticketId }
  });

  return Response.json({ status: "updated", draft: updated });
}
