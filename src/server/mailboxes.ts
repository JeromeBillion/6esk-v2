import { db } from "@/server/db";
import type { SessionUser } from "@/server/auth/session";
import { LEAD_ADMIN_ROLE } from "@/server/auth/roles";
import { tenantScopeFromUser } from "@/server/tenant-context";

export type MailboxSummary = {
  id: string;
  tenant_key?: string;
  workspace_key?: string;
  address: string;
  type: "platform" | "personal";
};

export async function listMailboxesForUser(user: SessionUser) {
  const { tenantKey } = tenantScopeFromUser(user);
  if (user.role_name === LEAD_ADMIN_ROLE) {
    const result = await db.query<MailboxSummary>(
      `SELECT id, tenant_key, workspace_key, address, type
       FROM mailboxes
       WHERE tenant_key = $1
       ORDER BY type, address`
      ,
      [tenantKey]
    );
    return result.rows;
  }

  const result = await db.query<MailboxSummary>(
    `SELECT m.id, m.tenant_key, m.workspace_key, m.address, m.type
     FROM mailboxes m
     JOIN mailbox_memberships mm ON mm.mailbox_id = m.id
     WHERE mm.user_id = $1
       AND m.tenant_key = $2
       AND mm.tenant_key = $2
     ORDER BY m.type, m.address`,
    [user.id, tenantKey]
  );

  return result.rows;
}

export async function listInboxMailboxesForUser(user: SessionUser) {
  const { tenantKey } = tenantScopeFromUser(user);
  const result = await db.query<MailboxSummary>(
    `SELECT m.id, m.tenant_key, m.workspace_key, m.address, m.type
     FROM mailboxes m
     JOIN mailbox_memberships mm ON mm.mailbox_id = m.id
     WHERE mm.user_id = $1
       AND m.tenant_key = $2
       AND mm.tenant_key = $2
       AND m.type = 'personal'
     ORDER BY m.address`,
    [user.id, tenantKey]
  );

  return result.rows;
}

export async function getPlatformMailbox(scope?: { tenantKey?: string | null }) {
  const tenantKey = scope?.tenantKey?.trim() || "primary";
  const result = await db.query<MailboxSummary>(
    `SELECT id, tenant_key, workspace_key, address, type
     FROM mailboxes
     WHERE type = 'platform'
       AND tenant_key = $1
     ORDER BY created_at ASC
     LIMIT 1`,
    [tenantKey]
  );
  return result.rows[0] ?? null;
}
