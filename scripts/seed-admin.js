const { Client } = require("pg");
const { randomBytes, scryptSync } = require("crypto");

const DEFAULT_TENANT_ID = "00000000-0000-0000-0000-000000000001";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

function getSeedTenantId() {
  const tenantId = (process.env.ADMIN_TENANT_ID ?? process.env.SEED_TENANT_ID ?? DEFAULT_TENANT_ID)
    .trim()
    .toLowerCase();
  if (!UUID_PATTERN.test(tenantId)) {
    throw new Error("ADMIN_TENANT_ID/SEED_TENANT_ID must be a valid UUID when provided");
  }
  return tenantId;
}

async function assertSeedTenantExists(client, tenantId) {
  const result = await client.query("SELECT id FROM tenants WHERE id = $1 LIMIT 1", [tenantId]);
  if (result.rows.length === 0) {
    throw new Error(`Seed tenant ${tenantId} does not exist; run migrations or provision the tenant first`);
  }
}

async function upsertRoles(client, tenantId) {
  for (const role of ROLE_DEFS) {
    const result = await client.query(
      `INSERT INTO roles (tenant_id, name, description)
       VALUES ($1, $2, $3)
       ON CONFLICT (name) DO UPDATE SET
         description = EXCLUDED.description
       WHERE roles.tenant_id = EXCLUDED.tenant_id
       RETURNING id`,
      [tenantId, role.name, role.description]
    );
    if (result.rows.length === 0) {
      throw new Error(`Role ${role.name} already exists outside seed tenant ${tenantId}`);
    }
  }
}

async function upsertTags(client, tenantId) {
  for (const tag of TAG_DEFS) {
    await client.query(
      `INSERT INTO tags (tenant_id, name, description)
       VALUES ($1, $2, $3)
       ON CONFLICT (tenant_id, name) DO UPDATE SET description = EXCLUDED.description`,
      [tenantId, tag.name, tag.description]
    );
  }
}

async function upsertMacros(client, tenantId) {
  for (const macro of MACRO_DEFS) {
    await client.query(
      `INSERT INTO macros (tenant_id, title, category, body)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (tenant_id, title) DO UPDATE SET
         category = EXCLUDED.category,
         body = EXCLUDED.body,
         updated_at = now()`,
      [tenantId, macro.title, macro.category, macro.body]
    );
  }
}

async function ensureSlaConfig(client, tenantId) {
  const result = await client.query(
    "SELECT id FROM sla_configs WHERE tenant_id = $1 AND is_active = true LIMIT 1",
    [tenantId]
  );
  if (result.rows.length > 0) {
    return;
  }

  await client.query(
    `INSERT INTO sla_configs (tenant_id, first_response_target_minutes, resolution_target_minutes, is_active)
     VALUES ($1, $2, $3, true)`,
    [tenantId, 120, 1440]
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

  const tenantId = getSeedTenantId();
  let committed = false;

  try {
    await client.query("BEGIN");
    await assertSeedTenantExists(client, tenantId);
    await upsertRoles(client, tenantId);
    await upsertTags(client, tenantId);
    await upsertMacros(client, tenantId);
    await ensureSlaConfig(client, tenantId);

    const roleResult = await client.query(
      "SELECT id FROM roles WHERE tenant_id = $1 AND name = 'lead_admin' LIMIT 1",
      [tenantId]
    );
    const roleId = roleResult.rows[0]?.id;
    if (!roleId) {
      throw new Error("lead_admin role not found");
    }

    const passwordHash = hashPassword(adminPassword);

    const userResult = await client.query(
      `INSERT INTO users (tenant_id, email, display_name, password_hash, role_id)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (email) DO UPDATE SET
         display_name = EXCLUDED.display_name,
         password_hash = EXCLUDED.password_hash,
         role_id = EXCLUDED.role_id
       WHERE users.tenant_id = EXCLUDED.tenant_id
       RETURNING id, email`,
      [tenantId, adminEmail.toLowerCase(), adminName, passwordHash, roleId]
    );
    if (userResult.rows.length === 0) {
      throw new Error(`Admin email ${adminEmail.toLowerCase()} already belongs to another tenant`);
    }

    const userId = userResult.rows[0].id;
    const userEmail = userResult.rows[0].email;
    const primaryPersonal = getPrimaryPersonalAddress(userEmail);

    const supportAddress = getSupportAddress();
    const mailboxSeeds = [
      { address: primaryPersonal, type: "personal" },
      ...(supportAddress ? [{ address: supportAddress, type: "platform" }] : [])
    ];

    for (const mailbox of mailboxSeeds) {
      const ownerUserId = mailbox.type === "personal" ? userId : null;
      const mailboxResult = await client.query(
        `INSERT INTO mailboxes (tenant_id, type, address, owner_user_id)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (address) DO UPDATE SET
           owner_user_id = COALESCE(mailboxes.owner_user_id, EXCLUDED.owner_user_id)
         WHERE mailboxes.tenant_id = EXCLUDED.tenant_id
         RETURNING id`,
        [tenantId, mailbox.type, mailbox.address, ownerUserId]
      );
      const mailboxId = mailboxResult.rows[0]?.id;
      if (!mailboxId) {
        throw new Error(`Mailbox address ${mailbox.address} already belongs to another tenant`);
      }

      await client.query(
        `INSERT INTO mailbox_memberships (tenant_id, mailbox_id, user_id, access_level)
         VALUES ($1, $2, $3, 'owner')
         ON CONFLICT (mailbox_id, user_id) DO UPDATE SET
           tenant_id = EXCLUDED.tenant_id,
           access_level = EXCLUDED.access_level`,
        [tenantId, mailboxId, userId]
      );
    }

    await client.query("COMMIT");
    committed = true;

    console.log(
      `Seeded lead admin and mailboxes for tenant ${tenantId}: ${mailboxSeeds
        .map((mailbox) => mailbox.address)
        .join(", ")}`
    );
  } catch (error) {
    if (!committed) {
      await client.query("ROLLBACK").catch(() => {});
    }
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
