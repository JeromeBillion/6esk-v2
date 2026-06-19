import { db } from "@/server/db";
import { getSessionUser } from "@/server/auth/session";
import { sessionTenantId } from "@/server/auth/tenant-session";
import { listInboxMailboxesForUser } from "@/server/mailboxes";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ mailboxId: string }> }
) {
  const { mailboxId } = await params;
  const user = await getSessionUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = sessionTenantId(user);
  if (!tenantId) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const mailboxes = await listInboxMailboxesForUser(user);
  const allowed = mailboxes.some((mailbox) => mailbox.id === mailboxId);
  if (!allowed) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const result = await db.query(
    `SELECT m.id, m.direction, m.channel, m.from_email, m.to_emails, m.subject, m.preview_text, m.received_at, m.sent_at,
            m.is_read, m.is_starred, m.is_pinned, m.is_spam, m.spam_reason, m.thread_id, m.message_id, m.created_at,
            COALESCE(
              m.metadata->>'mail_state',
              CASE
                WHEN m.direction = 'outbound' AND m.sent_at IS NULL THEN 'queued'
                WHEN m.direction = 'outbound' THEN 'sent'
                ELSE 'received'
              END
            ) AS mail_state,
            COALESCE(
              m.received_at,
              m.sent_at,
              NULLIF(m.metadata->>'draft_saved_at', '')::timestamptz,
              m.created_at
            ) AS sort_at,
            EXISTS (SELECT 1 FROM attachments a WHERE a.message_id = m.id AND a.tenant_id = $2) AS has_attachments
     FROM messages m
     WHERE m.mailbox_id = $1
       AND m.tenant_id = $2
     ORDER BY COALESCE(
              m.received_at,
              m.sent_at,
              NULLIF(m.metadata->>'draft_saved_at', '')::timestamptz,
              m.created_at
            ) DESC
     LIMIT 200`,
    [mailboxId, tenantId]
  );

  return Response.json({ messages: result.rows });
}
