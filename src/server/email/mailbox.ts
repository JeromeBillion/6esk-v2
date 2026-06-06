import { db } from "@/server/db";
import { resolveTenantScope, type TenantScopeInput } from "@/server/tenant-context";

export type MailboxRecord = {
  id: string;
  tenant_key?: string;
  workspace_key?: string;
  type: "platform" | "personal";
  address: string;
  owner_user_id: string | null;
};

export async function getOrCreateMailbox(
  address: string,
  supportAddress: string,
  scopeInput?: TenantScopeInput
) {
  const { tenantKey, workspaceKey } = resolveTenantScope(scopeInput);
  const mailboxType = address === supportAddress ? "platform" : "personal";
  const ownerResult = await db.query<{ id: string }>(
    "SELECT id FROM users WHERE lower(email) = $1 AND tenant_key = $2 LIMIT 1",
    [address, tenantKey]
  );
  const ownerUserId = ownerResult.rows[0]?.id ?? null;

  const result = await db.query<MailboxRecord>(
    `INSERT INTO mailboxes (tenant_key, workspace_key, type, address, owner_user_id)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (tenant_key, address) DO UPDATE SET
       address = EXCLUDED.address,
       owner_user_id = COALESCE(mailboxes.owner_user_id, EXCLUDED.owner_user_id)
     RETURNING id, tenant_key, workspace_key, type, address, owner_user_id`,
    [tenantKey, workspaceKey, mailboxType, address, ownerUserId]
  );

  const mailbox = result.rows[0];

  if (ownerUserId) {
    await db.query(
      `INSERT INTO mailbox_memberships (tenant_key, workspace_key, mailbox_id, user_id, access_level)
       VALUES ($1, $2, $3, $4, 'owner')
       ON CONFLICT (mailbox_id, user_id) DO NOTHING`,
      [tenantKey, workspaceKey, mailbox.id, ownerUserId]
    );
  }

  return mailbox;
}

export async function findMailbox(address: string, scopeInput?: TenantScopeInput) {
  const { tenantKey } = resolveTenantScope(scopeInput);
  const result = await db.query<MailboxRecord>(
    `SELECT id, tenant_key, workspace_key, type, address, owner_user_id
     FROM mailboxes
     WHERE address = $1
       AND tenant_key = $2`,
    [address, tenantKey]
  );
  return result.rows[0] ?? null;
}

export async function resolveInboundMailbox(
  address: string,
  supportAddress: string,
  scopeInput?: TenantScopeInput
) {
  if (address === supportAddress) {
    return getOrCreateMailbox(address, supportAddress, scopeInput);
  }

  const { tenantKey } = resolveTenantScope(scopeInput);
  const existing = await findMailbox(address, { tenantKey });
  if (existing) {
    return existing;
  }

  const ownerResult = await db.query<{ id: string }>(
    "SELECT id FROM users WHERE lower(email) = $1 AND tenant_key = $2 LIMIT 1",
    [address, tenantKey]
  );

  if (!ownerResult.rows[0]?.id) {
    return null;
  }

  return getOrCreateMailbox(address, supportAddress, scopeInput);
}
