const { Client } = require("pg");
const { randomBytes, scryptSync } = require("crypto");

const ROLE_DEFS = [
  { name: "lead_admin", description: "Full access to admin panel and mailboxes." },
  { name: "agent", description: "Handles support tickets and mailboxes." },
  { name: "viewer", description: "Read-only access to assigned mailboxes." }
];

const TAG_DEFS = [
  { name: "payments", description: "Deposits, withdrawals, wallet issues." },
  { name: "markets", description: "Trading, pricing, liquidity, positions." },
  { name: "account", description: "Login, OTP, email verification, profile." },
  { name: "kyc", description: "Identity verification and document checks." },
  { name: "security", description: "Frozen accounts, fraud, suspicious activity." },
  { name: "general", description: "General questions or uncategorized." }
];

const MACRO_DEFS = [
  {
    title: "KYC: Missing documents",
    category: "kyc",
    body:
      "Thanks for reaching out. It looks like one or more KYC documents are missing or unreadable. " +
      "Please re-submit the required documents: SA ID (front/back), selfie holding ID, and proof of address. " +
      "File types: JPG/PNG/WebP/PDF. Max size 10MB. Let us know once resubmitted."
  },
  {
    title: "Trading: Insufficient balance",
    category: "markets",
    body:
      "This error happens when your available balance is lower than the trade amount. " +
      "Please deposit funds first, then try again. If you believe this is incorrect, reply with the amount and timestamp."
  },
  {
    title: "Trading: Trade too large",
    category: "markets",
    body:
      "Trades are capped at 5% of market liquidity per trade. Please lower the trade size and try again. " +
      "If you need help splitting the trade, let us know."
  },
  {
    title: "Wallet: Withdrawals pending",
    category: "payments",
    body:
      "Withdrawal processing can take some time. Please share the withdrawal ID and the time you submitted it. " +
      "We will check the status and update you."
  },
  {
    title: "Account: OTP not received",
    category: "account",
    body:
      "If you didn’t receive your OTP, please check spam/junk and ensure your inbox is not full. " +
      "You can request a new OTP after a few minutes. If the issue persists, tell us the time you requested it."
  },
  {
    title: "Security: Account frozen",
    category: "security",
    body:
      "Your account may have been temporarily frozen for security review. " +
      "Please confirm your registered email and provide any recent activity details so we can investigate."
  }
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

async function upsertTags(client) {
  for (const tag of TAG_DEFS) {
    await client.query(
      `INSERT INTO tags (name, description)
       VALUES ($1, $2)
       ON CONFLICT (name) DO UPDATE SET description = EXCLUDED.description`,
      [tag.name, tag.description]
    );
  }
}

async function upsertMacros(client) {
  for (const macro of MACRO_DEFS) {
    await client.query(
      `INSERT INTO macros (title, category, body)
       VALUES ($1, $2, $3)
       ON CONFLICT (title) DO UPDATE SET
         category = EXCLUDED.category,
         body = EXCLUDED.body,
         updated_at = now()`,
      [macro.title, macro.category, macro.body]
    );
  }
}

async function ensureSlaConfig(client) {
  const result = await client.query(
    "SELECT id FROM sla_configs WHERE is_active = true LIMIT 1"
  );
  if (result.rows.length > 0) {
    return;
  }

  await client.query(
    `INSERT INTO sla_configs (first_response_target_minutes, resolution_target_minutes, is_active)
     VALUES ($1, $2, true)`,
    [120, 1440]
  );
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
    await upsertTags(client);
    await upsertMacros(client);
    await ensureSlaConfig(client);

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
