import { z } from "zod";
import { getSessionUser } from "@/server/auth/session";
import { isLeadAdmin } from "@/server/auth/roles";
import { db } from "@/server/db";
import {
  getTicketById,
  listTicketMessages,
  recordTicketEvent
} from "@/server/tickets";

const updateSchema = z.object({
  status: z.enum(["new", "open", "pending", "solved", "closed"]).optional(),
  priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
  assignedUserId: z.string().uuid().nullable().optional()
});

export async function GET(
  _request: Request,
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

  const isAdmin = isLeadAdmin(user);
  if (!isAdmin && ticket.assigned_user_id !== user.id) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const messages = await listTicketMessages(ticketId);
  return Response.json({ ticket, messages });
}

export async function PATCH(
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

  const assignProvided = Object.prototype.hasOwnProperty.call(parsed.data, "assignedUserId");
  if (assignProvided && !isAdmin) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const fields: string[] = [];
  const values: Array<string | null> = [];
  let index = 1;

  if (parsed.data.status) {
    fields.push(`status = $${index++}`);
    values.push(parsed.data.status);
  }

  if (parsed.data.priority) {
    fields.push(`priority = $${index++}`);
    values.push(parsed.data.priority);
  }

  if (assignProvided) {
    fields.push(`assigned_user_id = $${index++}`);
    values.push(parsed.data.assignedUserId ?? null);
  }

  if (fields.length === 0) {
    return Response.json({ ticket });
  }

  fields.push("updated_at = now()");
  values.push(ticketId);

  const result = await db.query(
    `UPDATE tickets
     SET ${fields.join(", ")}
     WHERE id = $${index}
     RETURNING id, requester_email, subject, status, priority, assigned_user_id, created_at, updated_at`,
    values
  );

  const updated = result.rows[0];

  if (parsed.data.status && parsed.data.status !== ticket.status) {
    await recordTicketEvent({
      ticketId,
      eventType: "status_updated",
      actorUserId: user.id,
      data: { from: ticket.status, to: parsed.data.status }
    });
  }

  if (parsed.data.priority && parsed.data.priority !== ticket.priority) {
    await recordTicketEvent({
      ticketId,
      eventType: "priority_updated",
      actorUserId: user.id,
      data: { from: ticket.priority, to: parsed.data.priority }
    });
  }

  if (assignProvided && parsed.data.assignedUserId !== ticket.assigned_user_id) {
    await recordTicketEvent({
      ticketId,
      eventType: "assignment_updated",
      actorUserId: user.id,
      data: { from: ticket.assigned_user_id, to: parsed.data.assignedUserId ?? null }
    });
  }

  return Response.json({ ticket: updated });
}
