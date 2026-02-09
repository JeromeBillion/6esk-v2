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
    `SELECT id, direction, from_email, subject, preview_text, received_at, sent_at, is_read
     FROM messages
     WHERE mailbox_id = $1
     ORDER BY COALESCE(received_at, sent_at, created_at) DESC
     LIMIT 50`,
    [mailboxId]
  );

  return Response.json({ messages: result.rows });
}
