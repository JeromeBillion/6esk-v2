import { db } from "@/server/db";
import type { SessionUser } from "@/server/auth/session";
import { LEAD_ADMIN_ROLE } from "@/server/auth/roles";

export type TicketRecord = {
  id: string;
  mailbox_id: string | null;
  requester_email: string;
  subject: string | null;
  status: string;
  priority: string;
  assigned_user_id: string | null;
  created_at: string;
  updated_at: string;
};

export async function resolveTicketIdForInbound(references: string[]) {
  if (references.length === 0) {
    return null;
  }

  const result = await db.query<{ ticket_id: string }>(
    `SELECT ticket_id
     FROM messages
     WHERE message_id = ANY($1)
       AND ticket_id IS NOT NULL
     LIMIT 1`,
    [references]
  );

  return result.rows[0]?.ticket_id ?? null;
}

export async function createTicket({
  mailboxId,
  requesterEmail,
  subject
}: {
  mailboxId: string;
  requesterEmail: string;
  subject?: string | null;
}) {
  const result = await db.query<{ id: string }>(
    `INSERT INTO tickets (mailbox_id, requester_email, subject)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [mailboxId, requesterEmail, subject ?? null]
  );

  return result.rows[0].id;
}

export async function recordTicketEvent({
  ticketId,
  eventType,
  actorUserId,
  data
}: {
  ticketId: string;
  eventType: string;
  actorUserId?: string | null;
  data?: Record<string, unknown> | null;
}) {
  await db.query(
    `INSERT INTO ticket_events (ticket_id, event_type, actor_user_id, data)
     VALUES ($1, $2, $3, $4)`,
    [ticketId, eventType, actorUserId ?? null, data ?? null]
  );
}

export async function reopenTicketIfNeeded(ticketId: string) {
  const result = await db.query<{ status: string }>(
    "SELECT status FROM tickets WHERE id = $1",
    [ticketId]
  );
  const status = result.rows[0]?.status;
  if (!status) {
    return;
  }

  if (status === "solved" || status === "closed") {
    await db.query(
      "UPDATE tickets SET status = 'open', updated_at = now() WHERE id = $1",
      [ticketId]
    );
    await recordTicketEvent({
      ticketId,
      eventType: "ticket_reopened",
      data: { previousStatus: status }
    });
  }
}

export async function listTicketsForUser(user: SessionUser) {
  if (user.role_name === LEAD_ADMIN_ROLE) {
    const result = await db.query<TicketRecord>(
      `SELECT id, mailbox_id, requester_email, subject, status, priority, assigned_user_id, created_at, updated_at
       FROM tickets
       ORDER BY created_at DESC`
    );
    return result.rows;
  }

  const result = await db.query<TicketRecord>(
    `SELECT id, mailbox_id, requester_email, subject, status, priority, assigned_user_id, created_at, updated_at
     FROM tickets
     WHERE assigned_user_id = $1
     ORDER BY created_at DESC`,
    [user.id]
  );
  return result.rows;
}

export async function getTicketById(ticketId: string) {
  const result = await db.query<TicketRecord>(
    `SELECT id, mailbox_id, requester_email, subject, status, priority, assigned_user_id, created_at, updated_at
     FROM tickets WHERE id = $1`,
    [ticketId]
  );
  return result.rows[0] ?? null;
}

export async function listTicketMessages(ticketId: string) {
  const result = await db.query(
    `SELECT id, direction, from_email, to_emails, subject, preview_text, received_at, sent_at
     FROM messages
     WHERE ticket_id = $1
     ORDER BY COALESCE(received_at, sent_at, created_at) ASC`,
    [ticketId]
  );
  return result.rows;
}
