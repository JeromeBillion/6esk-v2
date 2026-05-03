import { db } from "@/server/db";
import type { SessionUser } from "@/server/auth/session";
import { LEAD_ADMIN_ROLE } from "@/server/auth/roles";
import { DEFAULT_TENANT_ID } from "@/server/tenant/types";

export type MailboxSummary = {
  id: string;
  address: string;
  type: "platform" | "personal";
};

export async function listMailboxesForUser(user: SessionUser) {
  const tenantId = user.tenant_id ?? DEFAULT_TENANT_ID;
  if (user.role_name === LEAD_ADMIN_ROLE) {
    const result = await db.query<MailboxSummary>(
      `SELECT id, address, type
       FROM mailboxes
       WHERE tenant_id = $1
       ORDER BY type, address`,
      [tenantId]
    );
    return result.rows;
  }

  const result = await db.query<MailboxSummary>(
    `SELECT m.id, m.address, m.type
     FROM mailboxes m
     JOIN mailbox_memberships mm ON mm.mailbox_id = m.id
     WHERE mm.user_id = $1
       AND m.tenant_id = $2
     ORDER BY m.type, m.address`,
    [user.id, tenantId]
  );

  return result.rows;
}

export async function listInboxMailboxesForUser(user: SessionUser) {
  const tenantId = user.tenant_id ?? DEFAULT_TENANT_ID;
  const result = await db.query<MailboxSummary>(
    `SELECT m.id, m.address, m.type
     FROM mailboxes m
     JOIN mailbox_memberships mm ON mm.mailbox_id = m.id
     WHERE mm.user_id = $1
       AND m.tenant_id = $2
       AND m.type = 'personal'
     ORDER BY m.address`,
    [user.id, tenantId]
  );

  return result.rows;
}

export async function getPlatformMailbox(tenantId?: string | null) {
  const effectiveTenantId = tenantId ?? DEFAULT_TENANT_ID;
  const result = await db.query<MailboxSummary>(
    `SELECT id, address, type
     FROM mailboxes
     WHERE type = 'platform'
       AND tenant_id = $1
     ORDER BY created_at ASC
     LIMIT 1`,
    [effectiveTenantId]
  );
  return result.rows[0] ?? null;
}
