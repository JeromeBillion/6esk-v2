import { db } from "@/server/db";
import type { SessionUser } from "@/server/auth/session";
import { LEAD_ADMIN_ROLE } from "@/server/auth/roles";
import { sessionTenantId } from "@/server/auth/tenant-session";
import { DEFAULT_TENANT_ID } from "@/server/tenant/types";

export type MailboxSummary = {
  id: string;
  address: string;
  type: "platform" | "personal";
  provider: string;
  delivery_mode: "managed" | "connected";
};

export async function listMailboxesForUser(user: SessionUser) {
  const tenantId = sessionTenantId(user);
  if (!tenantId) {
    return [];
  }
  if (user.role_name === LEAD_ADMIN_ROLE) {
    const result = await db.query<MailboxSummary>(
      `SELECT id, address, type, provider::text,
              CASE
                WHEN provider = 'resend' OR oauth_connection_id IS NULL THEN 'managed'
                ELSE 'connected'
              END AS delivery_mode
       FROM mailboxes
       WHERE tenant_id = $1
       ORDER BY type, address`,
      [tenantId]
    );
    return result.rows;
  }

  const result = await db.query<MailboxSummary>(
    `SELECT m.id, m.address, m.type, m.provider::text,
            CASE
              WHEN m.provider = 'resend' OR m.oauth_connection_id IS NULL THEN 'managed'
              ELSE 'connected'
            END AS delivery_mode
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
  const tenantId = sessionTenantId(user);
  if (!tenantId) {
    return [];
  }
  const result = await db.query<MailboxSummary>(
    `SELECT m.id, m.address, m.type, m.provider::text,
            CASE
              WHEN m.provider = 'resend' OR m.oauth_connection_id IS NULL THEN 'managed'
              ELSE 'connected'
            END AS delivery_mode
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
    `SELECT id, address, type, provider::text,
            CASE
              WHEN provider = 'resend' OR oauth_connection_id IS NULL THEN 'managed'
              ELSE 'connected'
            END AS delivery_mode
     FROM mailboxes
     WHERE type = 'platform'
       AND tenant_id = $1
     ORDER BY created_at ASC
     LIMIT 1`,
    [effectiveTenantId]
  );
  return result.rows[0] ?? null;
}
