import { db } from "@/server/db";
import type { SessionUser } from "@/server/auth/session";
import { LEAD_ADMIN_ROLE } from "@/server/auth/roles";

export type MailboxSummary = {
  id: string;
  address: string;
  type: "platform" | "personal";
};

export async function listMailboxesForUser(user: SessionUser) {
  if (user.role_name === LEAD_ADMIN_ROLE) {
    const result = await db.query<MailboxSummary>(
      `SELECT id, address, type
       FROM mailboxes
       ORDER BY type, address`
    );
    return result.rows;
  }

  const result = await db.query<MailboxSummary>(
    `SELECT m.id, m.address, m.type
     FROM mailboxes m
     JOIN mailbox_memberships mm ON mm.mailbox_id = m.id
     WHERE mm.user_id = $1
     ORDER BY m.type, m.address`,
    [user.id]
  );

  return result.rows;
}

export async function getPlatformMailbox() {
  const result = await db.query<MailboxSummary>(
    `SELECT id, address, type
     FROM mailboxes
     WHERE type = 'platform'
     ORDER BY created_at ASC
     LIMIT 1`
  );
  return result.rows[0] ?? null;
}
