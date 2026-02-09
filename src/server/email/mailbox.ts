import { db } from "@/server/db";

export type MailboxRecord = {
  id: string;
  type: "platform" | "personal";
  address: string;
};

export async function getOrCreateMailbox(address: string, supportAddress: string) {
  const mailboxType = address === supportAddress ? "platform" : "personal";

  const result = await db.query<MailboxRecord>(
    `INSERT INTO mailboxes (type, address, owner_user_id)
     VALUES ($1, $2, NULL)
     ON CONFLICT (address) DO UPDATE SET address = EXCLUDED.address
     RETURNING id, type, address`,
    [mailboxType, address]
  );

  return result.rows[0];
}

export async function findMailbox(address: string) {
  const result = await db.query<MailboxRecord>(
    `SELECT id, type, address FROM mailboxes WHERE address = $1`,
    [address]
  );
  return result.rows[0] ?? null;
}
