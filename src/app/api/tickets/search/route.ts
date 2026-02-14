import { canManageTickets, isLeadAdmin } from "@/server/auth/roles";
import { getSessionUser } from "@/server/auth/session";
import { db } from "@/server/db";

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!canManageTickets(user)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(request.url);
  const query = (url.searchParams.get("q") ?? "").trim();
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 20) || 20, 1), 100);

  if (!query) {
    return Response.json({ tickets: [] });
  }

  const values: Array<string | number> = [];
  const conditions: string[] = ["t.merged_into_ticket_id IS NULL"];
  const like = `%${query}%`;
  values.push(like);
  conditions.push(
    `(t.id::text ILIKE $${values.length} OR t.subject ILIKE $${values.length} OR t.requester_email ILIKE $${values.length})`
  );

  if (!isLeadAdmin(user)) {
    values.push(user.id);
    conditions.push(`t.assigned_user_id = $${values.length}`);
  }

  values.push(limit);

  const result = await db.query<{
    id: string;
    subject: string | null;
    requester_email: string;
    status: string;
    priority: string;
    assigned_user_id: string | null;
    has_whatsapp: boolean;
    last_message_at: Date | null;
  }>(
    `SELECT
       t.id,
       t.subject,
       t.requester_email,
       t.status,
       t.priority,
       t.assigned_user_id,
       EXISTS (
         SELECT 1 FROM messages wm
         WHERE wm.ticket_id = t.id AND wm.channel = 'whatsapp'
       ) AS has_whatsapp,
       COALESCE(MAX(COALESCE(m.received_at, m.sent_at, m.created_at)), t.updated_at, t.created_at) AS last_message_at
     FROM tickets t
     LEFT JOIN messages m ON m.ticket_id = t.id
     WHERE ${conditions.join(" AND ")}
     GROUP BY t.id
     ORDER BY last_message_at DESC
     LIMIT $${values.length}`,
    values
  );

  return Response.json({
    tickets: result.rows.map((row) => ({
      id: row.id,
      subject: row.subject,
      requesterEmail: row.requester_email,
      status: row.status,
      priority: row.priority,
      assignedUserId: row.assigned_user_id,
      channel: row.has_whatsapp ? "whatsapp" : "email",
      lastMessageAt: row.last_message_at ? row.last_message_at.toISOString() : null
    }))
  });
}
