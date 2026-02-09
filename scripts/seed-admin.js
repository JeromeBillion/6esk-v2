const { Client } = require("pg");
const { randomBytes, scryptSync } = require("crypto");

const ROLE_DEFS = [
  { name: "lead_admin", description: "Full access to admin panel and mailboxes." },
  { name: "agent", description: "Handles support tickets and mailboxes." },
  { name: "viewer", description: "Read-only access to assigned mailboxes." }
];

function hashPassword(password) {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, 64);
  return `scrypt$${salt.toString("base64")}$${derived.toString("base64")}`;
}

function getSupportAddress() {
  if (process.env.SUPPORT_ADDRESS) {
    return process.env.SUPPORT_ADDRESS.toLowerCase();
  }
  const domain = process.env.RESEND_FROM_DOMAIN ?? "";
  return domain ? `support@${domain}`.toLowerCase() : null;
}

function getPrimaryPersonalAddress(adminEmail) {
  if (process.env.PRIMARY_PERSONAL_ADDRESS) {
    return process.env.PRIMARY_PERSONAL_ADDRESS.toLowerCase();
  }
  return adminEmail.toLowerCase();
}

async function upsertRoles(client) {
  for (const role of ROLE_DEFS) {
    await client.query(
      `INSERT INTO roles (name, description)
       VALUES ($1, $2)
       ON CONFLICT (name) DO UPDATE SET description = EXCLUDED.description`,
      [role.name, role.description]
    );
  }
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  const adminEmail = process.env.ADMIN_EMAIL;
  const adminPassword = process.env.ADMIN_PASSWORD;
  const adminName = process.env.ADMIN_NAME ?? "Lead Admin";

  if (!adminEmail || !adminPassword) {
    throw new Error("ADMIN_EMAIL and ADMIN_PASSWORD are required");
  }

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    await upsertRoles(client);

    const roleResult = await client.query(
      "SELECT id FROM roles WHERE name = 'lead_admin' LIMIT 1"
    );
    const roleId = roleResult.rows[0]?.id;
    if (!roleId) {
      throw new Error("lead_admin role not found");
    }

    const passwordHash = hashPassword(adminPassword);

    const userResult = await client.query(
      `INSERT INTO users (email, display_name, password_hash, role_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (email) DO UPDATE SET
         display_name = EXCLUDED.display_name,
         password_hash = EXCLUDED.password_hash,
         role_id = EXCLUDED.role_id
       RETURNING id, email`,
      [adminEmail.toLowerCase(), adminName, passwordHash, roleId]
    );

    const userId = userResult.rows[0].id;
    const userEmail = userResult.rows[0].email;
    const primaryPersonal = getPrimaryPersonalAddress(userEmail);

    const supportAddress = getSupportAddress();
    const mailboxSeeds = [
      { address: primaryPersonal, type: "personal" },
      ...(supportAddress ? [{ address: supportAddress, type: "platform" }] : [])
    ];

    for (const mailbox of mailboxSeeds) {
      const ownerUserId = mailbox.address === userEmail ? userId : null;
      await client.query(
        `INSERT INTO mailboxes (type, address, owner_user_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (address) DO UPDATE SET
           owner_user_id = COALESCE(mailboxes.owner_user_id, EXCLUDED.owner_user_id)`,
        [mailbox.type, mailbox.address, ownerUserId]
      );

      await client.query(
        `INSERT INTO mailbox_memberships (mailbox_id, user_id, access_level)
         SELECT id, $1, 'owner' FROM mailboxes WHERE address = $2
         ON CONFLICT (mailbox_id, user_id) DO NOTHING`,
        [userId, mailbox.address]
      );
    }

    console.log(
      `Seeded lead admin and mailboxes: ${mailboxSeeds
        .map((mailbox) => mailbox.address)
        .join(", ")}`
    );
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
