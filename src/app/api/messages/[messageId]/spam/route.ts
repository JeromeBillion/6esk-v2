import { z } from "zod";
import { getSessionUser } from "@/server/auth/session";
import { isLeadAdmin } from "@/server/auth/roles";
import { db } from "@/server/db";
import { getMessageById, getTicketAssignment, hasMailboxAccess } from "@/server/messages";
import { recordAuditLog } from "@/server/audit";

const schema = z.object({
  isSpam: z.boolean(),
  reason: z.string().optional().nullable()
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ messageId: string }> }
) {
  const user = await getSessionUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { messageId } = await params;
  const message = await getMessageById(messageId);
  if (!message) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const isAdmin = isLeadAdmin(user);
  if (!isAdmin) {
    if (message.ticket_id) {
      const assignedUserId = await getTicketAssignment(message.ticket_id);
      if (!assignedUserId || assignedUserId !== user.id) {
        return Response.json({ error: "Forbidden" }, { status: 403 });
      }
    } else {
      const allowed = await hasMailboxAccess(user.id, message.mailbox_id);
      if (!allowed) {
        return Response.json({ error: "Forbidden" }, { status: 403 });
      }
    }
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

  const result = await db.query(
    `UPDATE messages
     SET is_spam = $1, spam_reason = $2
     WHERE id = $3
     RETURNING id, is_spam, spam_reason`,
    [parsed.data.isSpam, parsed.data.reason ?? null, messageId]
  );

  await recordAuditLog({
    actorUserId: user.id,
    action: parsed.data.isSpam ? "message_marked_spam" : "message_unmarked_spam",
    entityType: "message",
    entityId: messageId,
    data: { reason: parsed.data.reason ?? null }
  });

  return Response.json({ status: "updated", message: result.rows[0] });
}
