import { getSessionUser } from "@/server/auth/session";
import { isLeadAdmin } from "@/server/auth/roles";
import {
  getAttachmentsForMessage,
  getMessageById,
  getTicketAssignment,
  hasMailboxAccess
} from "@/server/messages";
import { getObjectBuffer } from "@/server/storage/r2";

export async function GET(
  _request: Request,
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

  const attachments = await getAttachmentsForMessage(message.id);
  const textKey = message.r2_key_text;
  const htmlKey = message.r2_key_html;

  let text: string | null = null;
  let html: string | null = null;

  if (textKey) {
    const { buffer } = await getObjectBuffer(textKey);
    text = buffer.toString("utf-8");
  }

  if (htmlKey) {
    const { buffer } = await getObjectBuffer(htmlKey);
    html = buffer.toString("utf-8");
  }

  return Response.json({
    message: {
      id: message.id,
      subject: message.subject,
      from: message.from_email,
      to: message.to_emails,
      direction: message.direction,
      origin: message.origin,
      receivedAt: message.received_at,
      sentAt: message.sent_at,
      text,
      html,
      aiMeta: message.ai_meta ?? null
    },
    attachments
  });
}
