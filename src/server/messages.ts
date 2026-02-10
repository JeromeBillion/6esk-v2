import { db } from "@/server/db";

export type MessageRecord = {
  id: string;
  mailbox_id: string;
  ticket_id: string | null;
  subject: string | null;
  from_email: string;
  to_emails: string[];
  direction: "inbound" | "outbound";
  channel: "email" | "whatsapp";
  origin: "human" | "ai";
  is_spam: boolean;
  spam_reason: string | null;
  is_starred: boolean;
  is_pinned: boolean;
  thread_id: string | null;
  external_message_id?: string | null;
  conversation_id?: string | null;
  wa_contact?: string | null;
  wa_status?: string | null;
  wa_timestamp?: Date | null;
  provider?: string | null;
  received_at: Date | null;
  sent_at: Date | null;
  r2_key_text: string | null;
  r2_key_html: string | null;
  ai_meta?: Record<string, unknown> | null;
};

export async function getMessageById(messageId: string) {
  const result = await db.query<MessageRecord>(
    `SELECT id, mailbox_id, ticket_id, subject, from_email, to_emails, direction,
            channel, origin, is_spam, spam_reason, is_starred, is_pinned, thread_id,
            external_message_id, conversation_id, wa_contact, wa_status, wa_timestamp, provider,
            received_at, sent_at, r2_key_text, r2_key_html, ai_meta
     FROM messages
     WHERE id = $1`,
    [messageId]
  );
  return result.rows[0] ?? null;
}

export async function getAttachmentsForMessage(messageId: string) {
  const result = await db.query(
    `SELECT id, filename, content_type, size_bytes
     FROM attachments
     WHERE message_id = $1
     ORDER BY created_at`,
    [messageId]
  );
  return result.rows;
}

export async function getTicketAssignment(ticketId: string) {
  const result = await db.query<{ assigned_user_id: string | null }>(
    `SELECT assigned_user_id
     FROM tickets
     WHERE id = $1`,
    [ticketId]
  );
  return result.rows[0]?.assigned_user_id ?? null;
}

export async function hasMailboxAccess(userId: string, mailboxId: string) {
  const result = await db.query(
    `SELECT 1
     FROM mailbox_memberships
     WHERE mailbox_id = $1 AND user_id = $2
     LIMIT 1`,
    [mailboxId, userId]
  );
  return result.rowCount && result.rowCount > 0;
}
