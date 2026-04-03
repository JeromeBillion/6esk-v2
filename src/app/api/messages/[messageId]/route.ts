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
  let statusEvents: Array<{
    id: string;
    status: string;
    occurred_at: string | null;
    externalMessageId: string | null;
    source: string | null;
    payload: Record<string, unknown> | null;
  }> = [];
  let callSessionId: string | null = null;
  let callSession: {
    fromPhone: string | null;
    toPhone: string;
    direction: string;
    status: string;
    durationSeconds: number | null;
    createdBy: string;
    recordingUrl?: string | null;
    recordingR2Key?: string | null;
  } | null = null;
  let transcript: { available: boolean; text: string | null } | null = null;
  if (message.channel === "whatsapp") {
    const eventsResult = await db.query<{
      id: string;
      status: string;
      occurred_at: Date | null;
      external_message_id: string | null;
      payload: Record<string, unknown> | null;
    }>(
      `SELECT id, status, occurred_at, external_message_id, payload
       FROM whatsapp_status_events
       WHERE message_id = $1 OR external_message_id = $2
       ORDER BY occurred_at ASC, created_at ASC`,
      [message.id, message.external_message_id ?? null]
    );
    statusEvents = eventsResult.rows.map((row) => ({
      id: row.id,
      status: row.status,
      occurred_at: row.occurred_at ? new Date(row.occurred_at).toISOString() : null,
      externalMessageId: row.external_message_id ?? null,
      source:
        row.payload && typeof row.payload.source === "string"
          ? row.payload.source
          : null,
      payload: row.payload ?? null
    }));
  }
  if (message.channel === "voice") {
    const callSessionResult = await db.query<{
      id: string;
      status: string;
      from_phone: string | null;
      to_phone: string;
      direction: string;
      duration_seconds: number | null;
      started_at: Date | null;
      ended_at: Date | null;
      created_by: string;
      transcript_r2_key: string | null;
      recording_url: string | null;
      recording_r2_key: string | null;
    }>(
      `SELECT id, status, from_phone, to_phone, direction, duration_seconds, 
              started_at, ended_at, created_by, transcript_r2_key, recording_url, recording_r2_key
       FROM call_sessions
       WHERE message_id = $1
       ORDER BY updated_at DESC
       LIMIT 1`,
      [message.id]
    );
    const session = callSessionResult.rows[0];
    if (session) {
      callSessionId = session.id;
      callSession = {
        fromPhone: session.from_phone,
        toPhone: session.to_phone,
        direction: session.direction,
        status: session.status,
        durationSeconds: session.duration_seconds,
        createdBy: session.created_by,
        recordingUrl: session.recording_url,
        recordingR2Key: session.recording_r2_key
      };
      transcript = {
        available: Boolean(session.transcript_r2_key),
        text: null
      };
      if (session.transcript_r2_key) {
        try {
          const { buffer } = await getObjectBuffer(session.transcript_r2_key);
          transcript.text = buffer.toString("utf-8");
        } catch {
          transcript.text = null;
        }
      }
      // Add voice-specific status events
      const callEventsResult = await db.query<{
        id: string;
        event_type: string;
        occurred_at: Date | null;
        payload: Record<string, unknown> | null;
      }>(
        `SELECT id, event_type, occurred_at, payload
         FROM call_events
         WHERE call_session_id = $1
         ORDER BY occurred_at ASC`,
        [session.id]
      );
      statusEvents = callEventsResult.rows.map((row) => ({
        id: row.id,
        status: row.event_type,
        occurred_at: row.occurred_at ? new Date(row.occurred_at).toISOString() : null,
        externalMessageId: null,
        source: row.payload && typeof row.payload.source === "string" ? row.payload.source : null,
        payload: row.payload ?? null
      }));
    }
  }

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
      messageId: message.message_id ?? null,
      threadId: message.thread_id ?? null,
      inReplyTo: message.in_reply_to ?? null,
      references: message.reference_ids ?? [],
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
      callSessionId,
      callSession,
      transcript,
      statusEvents,
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

  const payload = body as { isStarred?: boolean; isPinned?: boolean; isRead?: boolean };
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

  if (typeof payload.isRead === "boolean") {
    updates.push(`is_read = $${index++}`);
    values.push(payload.isRead);
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
