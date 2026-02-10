import { getSessionUser } from "@/server/auth/session";
import { canManageTickets, isLeadAdmin } from "@/server/auth/roles";
import { recordAuditLog } from "@/server/audit";
import { getDraftById, updateDraftStatus } from "@/server/agents/drafts";
import { sendTicketReply } from "@/server/email/replies";
import { getTicketById, recordTicketEvent } from "@/server/tickets";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ ticketId: string; draftId: string }> }
) {
  const user = await getSessionUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!canManageTickets(user)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
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

  const draft = await getDraftById({ ticketId, draftId });
  if (!draft) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  if (draft.status !== "pending") {
    return Response.json({ error: "Draft is no longer pending" }, { status: 409 });
  }

  if (!draft.body_text && !draft.body_html) {
    return Response.json({ error: "Draft body required" }, { status: 400 });
  }

  try {
    const result = await sendTicketReply({
      ticketId,
      text: draft.body_text,
      html: draft.body_html,
      subject: draft.subject,
      actorUserId: user.id,
      origin: "ai",
      aiMeta: {
        draftId,
        integrationId: draft.integration_id,
        approvedBy: user.id
      }
    });

    const updated = await updateDraftStatus({
      draftId,
      ticketId,
      status: "used"
    });

    if (!updated) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }

    await recordTicketEvent({
      ticketId,
      eventType: "ai_draft_used",
      actorUserId: user.id,
      data: { draftId }
    });
    await recordAuditLog({
      actorUserId: user.id,
      action: "ai_draft_used",
      entityType: "agent_draft",
      entityId: draftId,
      data: { ticketId }
    });

    return Response.json({ status: "sent", messageId: result.messageId, draft: updated });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to send reply";
    return Response.json({ error: "Failed to send reply", details: message }, { status: 502 });
  }
}
