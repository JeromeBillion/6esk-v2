import { z } from "zod";
import { getSessionUser } from "@/server/auth/session";
import { canManageTickets, isLeadAdmin } from "@/server/auth/roles";
import { recordAuditLog } from "@/server/audit";
import { getTicketById, recordTicketEvent, addTagsToTicket, removeTagsFromTicket } from "@/server/tickets";

const schema = z
  .object({
    addTags: z.array(z.string()).optional().nullable(),
    removeTags: z.array(z.string()).optional().nullable()
  })
  .refine((data) => (data.addTags?.length ?? 0) > 0 || (data.removeTags?.length ?? 0) > 0, {
    message: "No tag updates provided"
  });

export async function PATCH(
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

  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    return Response.json({ error: "Invalid payload" }, { status: 400 });
  }

  const addTags = (parsed.data.addTags ?? []).map((tag) => tag.toLowerCase().trim()).filter(Boolean);
  const removeTags = (parsed.data.removeTags ?? [])
    .map((tag) => tag.toLowerCase().trim())
    .filter(Boolean);

  if (addTags.length) {
    await addTagsToTicket(ticketId, addTags);
  }
  if (removeTags.length) {
    await removeTagsFromTicket(ticketId, removeTags);
  }

  await recordTicketEvent({
    ticketId,
    eventType: "tags_updated",
    actorUserId: user.id,
    data: { add: addTags, remove: removeTags }
  });

  await recordAuditLog({
    actorUserId: user.id,
    action: "ticket_tags_updated",
    entityType: "ticket",
    entityId: ticketId,
    data: { add: addTags, remove: removeTags }
  });

  return Response.json({ status: "updated" });
}
