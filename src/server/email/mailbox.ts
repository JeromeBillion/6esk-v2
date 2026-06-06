import { db } from "@/server/db";
import { DEFAULT_TENANT_ID } from "@/server/tenant/types";

export type MailboxRecord = {
  id: string;
  tenant_id: string;
  type: "platform" | "personal";
  address: string;
  owner_user_id: string | null;
};

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
  const tenantId = tenantIdOverride ?? ownerResult.rows[0]?.tenant_id ?? DEFAULT_TENANT_ID;

  const result = await db.query<MailboxRecord>(
    `INSERT INTO mailboxes (tenant_id, type, address, owner_user_id)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (address) DO UPDATE SET
       address = EXCLUDED.address,
       owner_user_id = COALESCE(mailboxes.owner_user_id, EXCLUDED.owner_user_id)
     RETURNING id, tenant_id, type, address, owner_user_id`,
    [tenantId, mailboxType, address, ownerUserId]
  );

  const mailbox = result.rows[0];

  if (ownerUserId) {
    await db.query(
      `INSERT INTO mailbox_memberships (mailbox_id, user_id, access_level)
       VALUES ($1, $2, 'owner')
       ON CONFLICT (mailbox_id, user_id) DO NOTHING`,
      [mailbox.id, ownerUserId]
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

export async function resolveInboundMailbox(address: string, supportAddress: string) {
  if (address === supportAddress) {
    return getOrCreateMailbox(address, supportAddress);
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
