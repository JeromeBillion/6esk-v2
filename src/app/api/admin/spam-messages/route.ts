import { requireLeadAdminAccess } from "@/server/auth/admin-guard";
import { db } from "@/server/db";

export async function GET(request: Request) {
  const access = await requireLeadAdminAccess();
  if (!access.ok) return access.response;
  const { scope } = access;

  const url = new URL(request.url);
  const limitParam = url.searchParams.get("limit");
  const limit = Math.min(Math.max(Number(limitParam ?? 50) || 50, 1), 200);

  const result = await db.query(
    `SELECT m.id, m.subject, m.from_email, m.received_at, m.spam_reason,
            mb.address as mailbox_address
     FROM messages m
     JOIN mailboxes mb ON mb.id = m.mailbox_id AND mb.tenant_key = m.tenant_key
     WHERE m.is_spam = true
       AND m.tenant_key = $2
     ORDER BY m.received_at DESC NULLS LAST
     LIMIT $1`,
    [limit, scope.tenantKey]
  );

  return Response.json({ messages: result.rows });
}
