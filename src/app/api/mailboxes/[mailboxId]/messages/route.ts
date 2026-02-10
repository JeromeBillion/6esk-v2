import { db } from "@/server/db";
import { getSessionUser } from "@/server/auth/session";
import { listMailboxesForUser } from "@/server/mailboxes";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ mailboxId: string }> }
) {
  const { mailboxId } = await params;
  const user = await getSessionUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const mailboxes = await listMailboxesForUser(user);
  const allowed = mailboxes.some((mailbox) => mailbox.id === mailboxId);
  if (!allowed) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const result = await db.query(
    `SELECT m.id, m.direction, m.channel, m.from_email, m.subject, m.preview_text, m.received_at, m.sent_at,
            m.is_read, m.is_starred, m.is_pinned, m.thread_id, m.message_id, m.created_at,
            EXISTS (SELECT 1 FROM attachments a WHERE a.message_id = m.id) AS has_attachments
     FROM messages m
     WHERE m.mailbox_id = $1
     ORDER BY COALESCE(m.received_at, m.sent_at, m.created_at) DESC
     LIMIT 200`,
    [mailboxId]
  );

  return Response.json({ messages: result.rows });
}
