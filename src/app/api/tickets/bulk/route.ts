import { z } from "zod";
import { canManageTickets, isLeadAdmin } from "@/server/auth/roles";
import { getSessionUser } from "@/server/auth/session";
import { recordAuditLog } from "@/server/audit";
import { db } from "@/server/db";
import { addTagsToTicket, recordTicketEvent, removeTagsFromTicket } from "@/server/tickets";

const bulkPatchSchema = z
  .object({
    ticketIds: z.array(z.string().uuid()).min(1).max(200),
    status: z.enum(["new", "open", "pending", "solved", "closed"]).optional(),
    priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
    assignedUserId: z.string().uuid().nullable().optional(),
    addTags: z.array(z.string()).optional().nullable(),
    removeTags: z.array(z.string()).optional().nullable()
  })
  .refine(
    (data) =>
      Object.prototype.hasOwnProperty.call(data, "status") ||
      Object.prototype.hasOwnProperty.call(data, "priority") ||
      Object.prototype.hasOwnProperty.call(data, "assignedUserId") ||
      (data.addTags?.length ?? 0) > 0 ||
      (data.removeTags?.length ?? 0) > 0,
    { message: "No bulk updates provided." }
  );

type TicketSummaryRow = {
  id: string;
  status: "new" | "open" | "pending" | "solved" | "closed";
  priority: "low" | "normal" | "high" | "urgent";
  assigned_user_id: string | null;
};

export async function PATCH(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!canManageTickets(user)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = bulkPatchSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json({ error: "Invalid payload" }, { status: 400 });
  }

  const uniqueTicketIds = Array.from(new Set(parsed.data.ticketIds));
  const addTags = (parsed.data.addTags ?? [])
    .map((tag) => tag.toLowerCase().trim())
    .filter(Boolean);
  const removeTags = (parsed.data.removeTags ?? [])
    .map((tag) => tag.toLowerCase().trim())
    .filter(Boolean);

  const ticketsResult = await db.query<TicketSummaryRow>(
    `SELECT id, status, priority, assigned_user_id
     FROM tickets
     WHERE id = ANY($1::uuid[])
       AND merged_into_ticket_id IS NULL`,
    [uniqueTicketIds]
  );
  const rows = ticketsResult.rows;

  if (rows.length !== uniqueTicketIds.length) {
    const found = new Set(rows.map((row) => row.id));
    const missing = uniqueTicketIds.filter((id) => !found.has(id));
    return Response.json(
      {
        error: "Some tickets were not found.",
        missingTicketIds: missing
      },
      { status: 404 }
    );
  }

  const admin = isLeadAdmin(user);
  if (!admin && rows.some((row) => row.assigned_user_id !== user.id)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!admin && Object.prototype.hasOwnProperty.call(parsed.data, "assignedUserId")) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const updates: string[] = [];
  const values: Array<string | null | string[]> = [];
  let index = 1;

  if (Object.prototype.hasOwnProperty.call(parsed.data, "status")) {
    updates.push(`status = $${index++}`);
    values.push(parsed.data.status ?? null);
    if (parsed.data.status === "solved") {
      updates.push("solved_at = now()");
    }
    if (parsed.data.status === "closed") {
      updates.push("closed_at = now()");
    }
    if (parsed.data.status === "open" || parsed.data.status === "pending") {
      updates.push("solved_at = NULL");
      updates.push("closed_at = NULL");
    }
  }

  if (Object.prototype.hasOwnProperty.call(parsed.data, "priority")) {
    updates.push(`priority = $${index++}`);
    values.push(parsed.data.priority ?? null);
  }

  if (Object.prototype.hasOwnProperty.call(parsed.data, "assignedUserId")) {
    updates.push(`assigned_user_id = $${index++}`);
    values.push(parsed.data.assignedUserId ?? null);
  }

  if (updates.length > 0) {
    values.push(uniqueTicketIds);
    await db.query(
      `UPDATE tickets
       SET ${updates.join(", ")}, updated_at = now()
       WHERE id = ANY($${index}::uuid[])`,
      values
    );
  }

  for (const row of rows) {
    const ticketId = row.id;
    const auditChanges: Record<string, { from: string | null; to: string | null }> = {};

    if (Object.prototype.hasOwnProperty.call(parsed.data, "status") && parsed.data.status !== row.status) {
      await recordTicketEvent({
        ticketId,
        eventType: "status_updated",
        actorUserId: user.id,
        data: { from: row.status, to: parsed.data.status }
      });
      auditChanges.status = { from: row.status, to: parsed.data.status ?? null };
    }

    if (Object.prototype.hasOwnProperty.call(parsed.data, "priority") && parsed.data.priority !== row.priority) {
      await recordTicketEvent({
        ticketId,
        eventType: "priority_updated",
        actorUserId: user.id,
        data: { from: row.priority, to: parsed.data.priority }
      });
      auditChanges.priority = { from: row.priority, to: parsed.data.priority ?? null };
    }

    if (
      Object.prototype.hasOwnProperty.call(parsed.data, "assignedUserId") &&
      parsed.data.assignedUserId !== row.assigned_user_id
    ) {
      await recordTicketEvent({
        ticketId,
        eventType: "assignment_updated",
        actorUserId: user.id,
        data: { from: row.assigned_user_id, to: parsed.data.assignedUserId ?? null }
      });
      auditChanges.assignedUserId = {
        from: row.assigned_user_id,
        to: parsed.data.assignedUserId ?? null
      };
    }

    if (addTags.length > 0 || removeTags.length > 0) {
      if (addTags.length > 0) {
        await addTagsToTicket(ticketId, addTags);
      }
      if (removeTags.length > 0) {
        await removeTagsFromTicket(ticketId, removeTags);
      }
      await recordTicketEvent({
        ticketId,
        eventType: "tags_updated",
        actorUserId: user.id,
        data: { add: addTags, remove: removeTags }
      });
    }

    if (Object.keys(auditChanges).length > 0 || addTags.length > 0 || removeTags.length > 0) {
      await recordAuditLog({
        actorUserId: user.id,
        action: "ticket_bulk_updated",
        entityType: "ticket",
        entityId: ticketId,
        data: {
          updates: auditChanges,
          addTags,
          removeTags
        }
      });
    }
  }

  return Response.json({
    status: "updated",
    updatedTicketIds: uniqueTicketIds,
    updatedCount: uniqueTicketIds.length
  });
}
