import { z } from "zod";
import { getSessionUser } from "@/server/auth/session";
import { canManageTickets, isLeadAdmin } from "@/server/auth/roles";
import { db } from "@/server/db";
import {
  getTicketById,
  listTicketEvents,
  listTicketMessages,
  recordTicketEvent
} from "@/server/tickets";
import { buildAgentEvent } from "@/server/agents/events";
import { deliverPendingAgentEvents, enqueueAgentEvent } from "@/server/agents/outbox";
import { listDraftsForTicket } from "@/server/agents/drafts";
import { listAuditLogsForTicket } from "@/server/audit";
import { listLinkedTickets } from "@/server/merges";
import { DEFAULT_TENANT_ID } from "@/server/tenant/types";

const updateSchema = z.object({
  status: z.enum(["new", "open", "pending", "solved", "closed"]).optional(),
  priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
  assignedUserId: z.string().uuid().nullable().optional(),
  category: z.string().optional(),
  metadata: z.record(z.unknown()).optional()
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
  const tenantId = user.tenant_id ?? DEFAULT_TENANT_ID;
  const ticket = await getTicketById(ticketId, tenantId);
  if (!ticket) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const isAdmin = isLeadAdmin(user);
  if (!isAdmin && ticket.assigned_user_id !== user.id) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const [messages, events, drafts, auditLogs, linkedTickets] = await Promise.all([
    listTicketMessages(ticketId, tenantId),
    listTicketEvents(ticketId, tenantId),
    listDraftsForTicket(ticketId, tenantId),
    listAuditLogsForTicket(ticketId, tenantId, 50),
    listLinkedTickets(ticketId, tenantId)
  ]);
  return Response.json({ ticket, messages, events, drafts, auditLogs, linkedTickets });
}

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
  const tenantId = user.tenant_id ?? DEFAULT_TENANT_ID;
  const ticket = await getTicketById(ticketId, tenantId);
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
  const values: Array<unknown> = [];
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

  if (parsed.data.category) {
    fields.push(`category = $${index++}`);
    values.push(parsed.data.category);
  }

  if (parsed.data.metadata) {
    fields.push(`metadata = $${index++}`);
    values.push(parsed.data.metadata);
  }

  if (parsed.data.status && parsed.data.status !== ticket.status) {
    if (parsed.data.status === "solved") {
      fields.push(`solved_at = now()`);
    }
    if (parsed.data.status === "closed") {
      fields.push(`closed_at = now()`);
    }
    if (parsed.data.status === "open" || parsed.data.status === "pending") {
      fields.push(`solved_at = NULL`);
      fields.push(`closed_at = NULL`);
    }
  }

  if (fields.length === 0) {
    return Response.json({ ticket });
  }

  fields.push("updated_at = now()");
  const ticketIdParam = index++;
  const tenantIdParam = index++;
  values.push(ticketId, tenantId);

  await db.query(
    `UPDATE tickets
     SET ${fields.join(", ")}
     WHERE id = $${ticketIdParam}
       AND tenant_id = $${tenantIdParam}
     RETURNING id, requester_email, subject, status, priority, assigned_user_id, created_at, updated_at`,
    values
  );
  const updated = await getTicketById(ticketId, tenantId);

  if (parsed.data.status && parsed.data.status !== ticket.status) {
    await recordTicketEvent({
      tenantId,
      ticketId,
      eventType: "status_updated",
      actorUserId: user.id,
      data: { from: ticket.status, to: parsed.data.status }
    });

    const statusEvent = buildAgentEvent({
      eventType: "ticket.status.changed",
      ticketId,
      mailboxId: ticket.mailbox_id,
      tenantId,
      actorUserId: user.id,
      excerpt: `Status changed from ${ticket.status} to ${parsed.data.status}`
    });
    await enqueueAgentEvent({ eventType: "ticket.status.changed", payload: statusEvent, tenantId });
    void deliverPendingAgentEvents({ tenantId }).catch(() => {});
  }

  if (parsed.data.priority && parsed.data.priority !== ticket.priority) {
    await recordTicketEvent({
      tenantId,
      ticketId,
      eventType: "priority_updated",
      actorUserId: user.id,
      data: { from: ticket.priority, to: parsed.data.priority }
    });
  }

  if (assignProvided && parsed.data.assignedUserId !== ticket.assigned_user_id) {
    await recordTicketEvent({
      tenantId,
      ticketId,
      eventType: "assignment_updated",
      actorUserId: user.id,
      data: { from: ticket.assigned_user_id, to: parsed.data.assignedUserId ?? null }
    });
  }

  return Response.json({ ticket: updated ?? ticket });
}
