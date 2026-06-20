import { getSessionUser } from "@/server/auth/session";
import { isLeadAdmin } from "@/server/auth/roles";
import { sessionTenantId } from "@/server/auth/tenant-session";
import { db } from "@/server/db";

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!isLeadAdmin(user)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  const tenantId = sessionTenantId(user);
  if (!tenantId) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(request.url);
  const limitParam = url.searchParams.get("limit");
  const limit = Math.min(Math.max(Number(limitParam ?? 50) || 50, 1), 200);

  const result = await db.query(
    `SELECT m.id, m.subject, m.from_email, m.received_at, m.spam_reason,
            mb.address as mailbox_address
     FROM messages m
     JOIN mailboxes mb ON mb.id = m.mailbox_id AND mb.tenant_id = m.tenant_id
     WHERE m.tenant_id = $1
       AND m.is_spam = true
     ORDER BY m.received_at DESC NULLS LAST
     LIMIT $2`,
    [tenantId, limit]
  );

  return Response.json({ messages: result.rows });
}
