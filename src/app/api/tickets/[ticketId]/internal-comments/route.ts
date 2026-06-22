import { z } from "zod";
import { recordAuditLog } from "@/server/audit";
import { getSessionUser } from "@/server/auth/session";
import { canManageTickets, isLeadAdmin } from "@/server/auth/roles";
import { sessionTenantId } from "@/server/auth/tenant-session";
import { createTicketInternalComment, getTicketById } from "@/server/tickets";

const internalCommentSchema = z.object({
  body: z.string().trim().min(1).max(5000),
  metadata: z.record(z.unknown()).optional().nullable()
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
  const tenantId = sessionTenantId(user);
  if (!tenantId) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

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
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = internalCommentSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json({ error: "Invalid payload" }, { status: 400 });
  }

  const comment = await createTicketInternalComment({
    tenantId,
    ticketId,
    body: parsed.data.body,
    actorUserId: user.id,
    origin: "human",
    metadata: parsed.data.metadata ?? null
  });

  await recordAuditLog({
    tenantId,
    action: "internal_comment_created",
    entityType: "ticket",
    entityId: ticketId,
    actorUserId: user.id,
    data: {
      visibility: "internal",
      commentId: comment.id
    }
  });

  return Response.json({ comment });
}
