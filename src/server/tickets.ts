import { db } from "@/server/db";
import type { SessionUser } from "@/server/auth/session";
import { LEAD_ADMIN_ROLE } from "@/server/auth/roles";

export type TicketRecord = {
  id: string;
  mailbox_id: string | null;
  requester_email: string;
  subject: string | null;
  category: string | null;
  metadata: Record<string, unknown> | null;
  tags?: string[];
  has_whatsapp?: boolean;
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
  subject,
  category,
  metadata
}: {
  mailboxId: string;
  requesterEmail: string;
  subject?: string | null;
  category?: string | null;
  metadata?: Record<string, unknown> | null;
}) {
  const result = await db.query<{ id: string }>(
    `INSERT INTO tickets (mailbox_id, requester_email, subject, category, metadata)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [mailboxId, requesterEmail, subject ?? null, category ?? null, metadata ?? {}]
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

export async function ensureTags(tagNames: string[]) {
  const clean = Array.from(new Set(tagNames.map((tag) => tag.toLowerCase().trim()).filter(Boolean)));
  if (clean.length === 0) {
    return [];
  }

  const ids: string[] = [];
  for (const tag of clean) {
    const result = await db.query<{ id: string }>(
      `INSERT INTO tags (name)
       VALUES ($1)
       ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [tag]
    );
    ids.push(result.rows[0].id);
  }
  return ids;
}

export async function addTagsToTicket(ticketId: string, tagNames: string[]) {
  const tagIds = await ensureTags(tagNames);
  for (const tagId of tagIds) {
    await db.query(
      `INSERT INTO ticket_tags (ticket_id, tag_id)
       VALUES ($1, $2)
       ON CONFLICT (ticket_id, tag_id) DO NOTHING`,
      [ticketId, tagId]
    );
  }
}

export async function removeTagsFromTicket(ticketId: string, tagNames: string[]) {
  const clean = Array.from(
    new Set(tagNames.map((tag) => tag.toLowerCase().trim()).filter(Boolean))
  );
  if (clean.length === 0) {
    return;
  }

  await db.query(
    `DELETE FROM ticket_tags
     WHERE ticket_id = $1
       AND tag_id IN (
         SELECT id FROM tags WHERE name = ANY($2)
       )`,
    [ticketId, clean]
  );
}

export function inferTagsFromText({
  subject,
  text
}: {
  subject?: string | null;
  text?: string | null;
}) {
  const haystack = `${subject ?? ""} ${text ?? ""}`.toLowerCase();
  const tags = new Set<string>();

  if (/(kyc|verify|verification|id number|selfie)/.test(haystack)) {
    tags.add("kyc");
  }
  if (/(withdraw|deposit|wallet|payment|payout|bank)/.test(haystack)) {
    tags.add("payments");
  }
  if (/(trade|market|price|liquidity|position|shares|yes|no)/.test(haystack)) {
    tags.add("markets");
  }
  if (/(otp|login|email verification|password|account)/.test(haystack)) {
    tags.add("account");
  }
  if (/(frozen|security|suspicious|hack|fraud)/.test(haystack)) {
    tags.add("security");
  }

  if (tags.size === 0) {
    tags.add("general");
  }

  return Array.from(tags);
}

export async function listTicketsForUser(
  user: SessionUser,
  filters?: {
    status?: string | null;
    priority?: string | null;
    tag?: string | null;
    search?: string | null;
    assignedUserId?: string | null;
    channel?: string | null;
  }
) {
  const values: Array<string> = [];
  const conditions: string[] = [];

  const isAdmin = user.role_name === LEAD_ADMIN_ROLE;
  if (!isAdmin) {
    values.push(user.id);
    conditions.push(`t.assigned_user_id = $${values.length}`);
  } else if (filters?.assignedUserId) {
    values.push(filters.assignedUserId);
    conditions.push(`t.assigned_user_id = $${values.length}`);
  }

  if (filters?.status) {
    values.push(filters.status);
    conditions.push(`t.status = $${values.length}`);
  }

  if (filters?.priority) {
    values.push(filters.priority);
    conditions.push(`t.priority = $${values.length}`);
  }

  if (filters?.search) {
    values.push(`%${filters.search}%`);
    conditions.push(
      `(t.subject ILIKE $${values.length} OR t.requester_email ILIKE $${values.length})`
    );
  }

  if (filters?.tag) {
    values.push(filters.tag.toLowerCase());
    conditions.push(
      `EXISTS (
        SELECT 1
        FROM ticket_tags ttf
        JOIN tags tagf ON tagf.id = ttf.tag_id
        WHERE ttf.ticket_id = t.id AND tagf.name = $${values.length}
      )`
    );
  }

  if (filters?.channel) {
    const channel = filters.channel.toLowerCase();
    if (channel === "whatsapp") {
      values.push("whatsapp");
      const placeholder = `$${values.length}`;
      conditions.push(
        `EXISTS (
          SELECT 1
          FROM messages channel_msg
          WHERE channel_msg.ticket_id = t.id AND channel_msg.channel = ${placeholder}
        )`
      );
    }
    if (channel === "email") {
      values.push("whatsapp");
      const placeholder = `$${values.length}`;
      conditions.push(
        `NOT EXISTS (
          SELECT 1
          FROM messages channel_msg
          WHERE channel_msg.ticket_id = t.id AND channel_msg.channel = ${placeholder}
        )`
      );
    }
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const result = await db.query<TicketRecord>(
    `SELECT t.id, t.mailbox_id, t.requester_email, t.subject, t.category, t.metadata,
            t.status, t.priority, t.assigned_user_id, t.created_at, t.updated_at,
            COALESCE(array_agg(tag.name) FILTER (WHERE tag.name IS NOT NULL), '{}') AS tags,
            EXISTS (
              SELECT 1 FROM messages msg
              WHERE msg.ticket_id = t.id AND msg.channel = 'whatsapp'
            ) AS has_whatsapp
     FROM tickets t
     LEFT JOIN ticket_tags tt ON tt.ticket_id = t.id
     LEFT JOIN tags tag ON tag.id = tt.tag_id
     ${whereClause}
     GROUP BY t.id
     ORDER BY t.created_at DESC`,
    values
  );

  return result.rows;
}

export async function getTicketById(ticketId: string) {
  const result = await db.query<TicketRecord>(
    `SELECT t.id, t.mailbox_id, t.requester_email, t.subject, t.category, t.metadata,
            t.status, t.priority, t.assigned_user_id, t.created_at, t.updated_at,
            COALESCE(array_agg(tag.name) FILTER (WHERE tag.name IS NOT NULL), '{}') AS tags,
            EXISTS (
              SELECT 1 FROM messages msg
              WHERE msg.ticket_id = t.id AND msg.channel = 'whatsapp'
            ) AS has_whatsapp
     FROM tickets t
     LEFT JOIN ticket_tags tt ON tt.ticket_id = t.id
     LEFT JOIN tags tag ON tag.id = tt.tag_id
     WHERE t.id = $1
     GROUP BY t.id`,
    [ticketId]
  );
  return result.rows[0] ?? null;
}

export async function listTicketMessages(ticketId: string) {
  const result = await db.query(
    `SELECT id, direction, channel, origin, from_email, to_emails, subject, preview_text,
            received_at, sent_at, wa_status, wa_timestamp, wa_contact, conversation_id
     FROM messages
     WHERE ticket_id = $1
     ORDER BY COALESCE(received_at, sent_at, created_at) ASC`,
    [ticketId]
  );
  return result.rows;
}

export async function listTicketEvents(ticketId: string) {
  const result = await db.query(
    `SELECT id, event_type, actor_user_id, data, created_at
     FROM ticket_events
     WHERE ticket_id = $1
     ORDER BY created_at ASC`,
    [ticketId]
  );
  return result.rows;
}
