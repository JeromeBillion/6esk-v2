import { db } from "@/server/db";

export type MailboxRecord = {
  id: string;
  tenant_id: string;
  type: "platform" | "personal";
  address: string;
  owner_user_id: string | null;
};

function normalizeTenantId(tenantId: string | null | undefined) {
  const normalized = tenantId?.trim();
  return normalized || null;
}

function requireTenantId(tenantId: string | null | undefined, operation: string) {
  const normalized = normalizeTenantId(tenantId);
  if (!normalized) {
    throw new Error(`${operation} requires tenantId`);
  }
  return normalized;
}

export async function getOrCreateMailbox(
  address: string,
  supportAddress: string,
  tenantIdOverride?: string | null
) {
  const mailboxType = address === supportAddress ? "platform" : "personal";
  const ownerResult = await db.query<{ id: string; tenant_id: string | null }>(
    "SELECT id, tenant_id FROM users WHERE lower(email) = $1 LIMIT 1",
    [address]
  );
  const ownerUserId = ownerResult.rows[0]?.id ?? null;
  const tenantId = requireTenantId(
    normalizeTenantId(tenantIdOverride) ?? normalizeTenantId(ownerResult.rows[0]?.tenant_id),
    "Create mailbox"
  );

  const result = await db.query<MailboxRecord>(
    `INSERT INTO mailboxes (tenant_id, type, address, owner_user_id)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (address) DO UPDATE SET
       address = EXCLUDED.address,
       owner_user_id = COALESCE(mailboxes.owner_user_id, EXCLUDED.owner_user_id)
     WHERE mailboxes.tenant_id = EXCLUDED.tenant_id
     RETURNING id, tenant_id, type, address, owner_user_id`,
    [tenantId, mailboxType, address, ownerUserId]
  );

  const mailbox = result.rows[0];
  if (!mailbox) {
    throw new Error("Mailbox address belongs to another tenant.");
  }

  if (ownerUserId) {
    if (mailbox.tenant_id !== tenantId) {
      throw new Error("Mailbox belongs to another tenant.");
    }

    await db.query(
      `INSERT INTO mailbox_memberships (tenant_id, mailbox_id, user_id, access_level)
       VALUES ($1, $2, $3, 'owner')
       ON CONFLICT (mailbox_id, user_id) DO UPDATE SET
         tenant_id = EXCLUDED.tenant_id,
         access_level = EXCLUDED.access_level`,
      [tenantId, mailbox.id, ownerUserId]
    );
  }

  return mailbox;
}

export async function findMailbox(address: string) {
  const result = await db.query<MailboxRecord>(
    `SELECT id, tenant_id, type, address, owner_user_id FROM mailboxes WHERE address = $1`,
    [address]
  );
  return result.rows[0] ?? null;
}

export async function findMailboxForOAuthConnection(connectionId: string, tenantId: string) {
  const result = await db.query<MailboxRecord>(
    `SELECT id, tenant_id, type, address, owner_user_id
     FROM mailboxes
     WHERE oauth_connection_id = $1
       AND tenant_id = $2
     LIMIT 1`,
    [connectionId, tenantId]
  );
  return result.rows[0] ?? null;
}

export async function resolveInboundMailbox(address: string, supportAddress: string) {
  if (address === supportAddress) {
    return findMailbox(address);
  }

  const existing = await findMailbox(address);
  if (existing) {
    return existing;
  }

  const ownerResult = await db.query<{ id: string }>(
    "SELECT id FROM users WHERE lower(email) = $1 LIMIT 1",
    [address]
  );

  if (!ownerResult.rows[0]?.id) {
    return null;
  }

  return getOrCreateMailbox(address, supportAddress);
}
