import { getSessionUser } from "@/server/auth/session";
import { isLeadAdmin } from "@/server/auth/roles";
import {
  getAttachmentsForMessage,
  getMessageById,
  getTicketAssignment,
  hasMailboxAccess
} from "@/server/messages";
import { getObjectBuffer } from "@/server/storage/r2";
import { db } from "@/server/db";

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
      channel: message.channel,
      origin: message.origin,
      isStarred: message.is_starred,
      isPinned: message.is_pinned,
      isSpam: message.is_spam,
      spamReason: message.spam_reason,
      receivedAt: message.received_at,
      sentAt: message.sent_at,
      waStatus: message.wa_status ?? null,
      waTimestamp: message.wa_timestamp ?? null,
      waContact: message.wa_contact ?? null,
      conversationId: message.conversation_id ?? null,
      provider: message.provider ?? null,
      text,
      html,
      aiMeta: message.ai_meta ?? null
    },
    attachments
  });
}

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

  let body: unknown;
  try {
    body = await request.json();
  } catch (error) {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const payload = body as { isStarred?: boolean; isPinned?: boolean };
  const updates: string[] = [];
  const values: Array<boolean | string> = [];
  let index = 1;

  if (typeof payload.isStarred === "boolean") {
    updates.push(`is_starred = $${index++}`);
    values.push(payload.isStarred);
  }

  if (typeof payload.isPinned === "boolean") {
    updates.push(`is_pinned = $${index++}`);
    values.push(payload.isPinned);
  }

  if (updates.length === 0) {
    return Response.json({ error: "No updates provided" }, { status: 400 });
  }

  let updatedIds: string[] = [];
  if (message.thread_id) {
    values.push(message.thread_id, message.id, message.mailbox_id);
    const result = await db.query<{ id: string }>(
      `UPDATE messages
       SET ${updates.join(", ")}
       WHERE (thread_id = $${index++} OR id = $${index++})
         AND mailbox_id = $${index++}
       RETURNING id`,
      values
    );
    updatedIds = result.rows.map((row) => row.id);
  } else {
    values.push(message.id);
    const result = await db.query<{ id: string }>(
      `UPDATE messages
       SET ${updates.join(", ")}
       WHERE id = $${index++}
       RETURNING id`,
      values
    );
    updatedIds = result.rows.map((row) => row.id);
  }

  return Response.json({ status: "ok", updatedIds });
}
