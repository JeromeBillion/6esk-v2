import { db } from "@/server/db";

export type MailboxRecord = {
  id: string;
  type: "platform" | "personal";
  address: string;
  owner_user_id: string | null;
};

export async function getOrCreateMailbox(address: string, supportAddress: string) {
  const mailboxType = address === supportAddress ? "platform" : "personal";
  const ownerResult = await db.query<{ id: string }>(
    "SELECT id FROM users WHERE lower(email) = $1 LIMIT 1",
    [address]
  );
  const ownerUserId = ownerResult.rows[0]?.id ?? null;

  const result = await db.query<MailboxRecord>(
    `INSERT INTO mailboxes (type, address, owner_user_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (address) DO UPDATE SET
       address = EXCLUDED.address,
       owner_user_id = COALESCE(mailboxes.owner_user_id, EXCLUDED.owner_user_id)
     RETURNING id, type, address, owner_user_id`,
    [mailboxType, address, ownerUserId]
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
    `SELECT id, type, address, owner_user_id FROM mailboxes WHERE address = $1`,
    [address]
  );
  return result.rows[0] ?? null;
}
