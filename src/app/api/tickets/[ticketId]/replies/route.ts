import { z } from "zod";
import { getSessionUser } from "@/server/auth/session";
import { canManageTickets, isLeadAdmin } from "@/server/auth/roles";
import { getTicketById } from "@/server/tickets";
import { sendTicketReply } from "@/server/email/replies";

const replySchema = z.object({
  text: z.string().optional().nullable(),
  html: z.string().optional().nullable(),
  subject: z.string().optional().nullable()
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ ticketId: string }> }
) {
  const user = await getSessionUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!canManageTickets(user)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { ticketId } = await params;
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

  const parsed = replySchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json({ error: "Invalid payload" }, { status: 400 });
  }

  const { text, html, subject } = parsed.data;
  if (!text && !html) {
    return Response.json({ error: "Reply body required" }, { status: 400 });
  }

  try {
    const result = await sendTicketReply({
      ticketId,
      text,
      html,
      subject,
      actorUserId: user.id,
      origin: "human"
    });
    return Response.json({ status: "sent", id: result.messageId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to send reply";
    return Response.json({ error: "Resend request failed", details: message }, { status: 502 });
  }
}
