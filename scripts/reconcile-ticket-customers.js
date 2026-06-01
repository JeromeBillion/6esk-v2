const { Pool } = require("pg");

function normalizeEmail(value) {
  if (!value || typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return normalized || null;
}

function normalizePhone(value) {
  if (!value || typeof value !== "string") return null;
  const normalized = value.replace(/[^\d+]/g, "").trim();
  return normalized || null;
}

function parseBoolean(value, fallback) {
  if (value == null || value === "") return fallback;
  const normalized = String(value).trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function parseInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseReconcileScope(env = process.env) {
  const tenantKey = String(
    env.CUSTOMER_RECONCILE_TENANT_KEY ||
      env.CUSTOMER_RECONCILE_TENANT ||
      (env.NODE_ENV === "production" ? "" : "primary")
  ).trim();
  const workspaceKey = String(
    env.CUSTOMER_RECONCILE_WORKSPACE_KEY ||
      env.CUSTOMER_RECONCILE_WORKSPACE ||
      (env.NODE_ENV === "production" ? "" : "primary")
  ).trim();

  if (!tenantKey || !workspaceKey) {
    throw new Error(
      "CUSTOMER_RECONCILE_TENANT_KEY and CUSTOMER_RECONCILE_WORKSPACE_KEY are required in production"
    );
  }

  return { tenantKey, workspaceKey };
}

function toObject(value) {
  if (!value) return {};
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function deriveTicketIdentity(ticket) {
  const requester = ticket.requester_email || "";
  const metadata = toObject(ticket.metadata);
  const externalProfile =
    metadata && typeof metadata.external_profile === "object" && metadata.external_profile
      ? metadata.external_profile
      : null;

  const externalSystem =
    externalProfile && typeof externalProfile.source === "string"
      ? externalProfile.source
      : null;
  const externalUserId =
    externalProfile && typeof externalProfile.externalUserId === "string"
      ? externalProfile.externalUserId
      : null;

  const email = requester.startsWith("whatsapp:")
    ? null
    : normalizeEmail(requester) || normalizeEmail(externalProfile?.email) || null;
  const phone = requester.startsWith("whatsapp:")
    ? normalizePhone(requester.replace(/^whatsapp:/, ""))
    : normalizePhone(externalProfile?.phoneNumber) || null;

  return {
    email,
    phone,
    externalSystem,
    externalUserId,
    displayName:
      externalProfile && typeof externalProfile.fullName === "string"
        ? externalProfile.fullName
        : null
  };
}

async function findCustomerByExternal(client, scope, externalSystem, externalUserId) {
  if (!externalSystem || !externalUserId) return null;
  const result = await client.query(
    `SELECT id
     FROM customers
     WHERE tenant_key = $1
       AND external_system = $2
       AND external_user_id = $3
       AND merged_into_customer_id IS NULL
     LIMIT 1`,
    [scope.tenantKey, externalSystem, externalUserId]
  );
  return result.rows[0]?.id ?? null;
}

async function findCustomerByIdentity(client, scope, email, phone) {
  const conditions = [];
  const values = [scope.tenantKey];

  if (email) {
    values.push("email", email);
    conditions.push(
      `(ci.identity_type = $${values.length - 1} AND ci.identity_value = $${values.length})`
    );
  }
  if (phone) {
    values.push("phone", phone);
    conditions.push(
      `(ci.identity_type = $${values.length - 1} AND ci.identity_value = $${values.length})`
    );
  }

  if (!conditions.length) return null;

  const result = await client.query(
    `SELECT c.id
     FROM customer_identities ci
     JOIN customers c ON c.id = ci.customer_id
     WHERE ci.tenant_key = $1
       AND c.tenant_key = $1
       AND c.merged_into_customer_id IS NULL
       AND (${conditions.join(" OR ")})
     ORDER BY CASE c.kind WHEN 'registered' THEN 0 ELSE 1 END, c.created_at ASC
     LIMIT 1`,
    values
  );
  return result.rows[0]?.id ?? null;
}

async function createUnregisteredCustomer(client, scope, displayName, email, phone) {
  const result = await client.query(
    `INSERT INTO customers (tenant_key, workspace_key, kind, display_name, primary_email, primary_phone)
     VALUES ($1, $2, 'unregistered', $3, $4, $5)
     RETURNING id`,
    [scope.tenantKey, scope.workspaceKey, displayName ?? null, email ?? null, phone ?? null]
  );
  return result.rows[0].id;
}

async function addIdentity(client, scope, customerId, type, value, isPrimary, source) {
  if (!value) return;
  await client.query(
    `INSERT INTO customer_identities (
      tenant_key,
      workspace_key,
      customer_id,
      identity_type,
      identity_value,
      is_primary,
      source,
      updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, now())
    ON CONFLICT (tenant_key, identity_type, identity_value) DO NOTHING`,
    [scope.tenantKey, scope.workspaceKey, customerId, type, value, isPrimary, source]
  );
}

async function reconcileTicket(client, ticket, dryRun, scope) {
  const identity = deriveTicketIdentity(ticket);
  let customerId =
    (await findCustomerByExternal(client, scope, identity.externalSystem, identity.externalUserId)) ||
    (await findCustomerByIdentity(client, scope, identity.email, identity.phone));

  let createdCustomer = false;
  if (!customerId && !dryRun) {
    customerId = await createUnregisteredCustomer(
      client,
      scope,
      identity.displayName,
      identity.email,
      identity.phone
    );
    createdCustomer = true;
  }

  if (!customerId) {
    return {
      linked: false,
      createdCustomer: false,
      source: "unresolved"
    };
  }

  if (dryRun) {
    return {
      linked: true,
      createdCustomer: false,
      source: identity.externalUserId ? "external_or_identity" : "identity"
    };
  }

  const identitySource = identity.externalUserId ? "profile_lookup" : "backfill_reconcile";
  await addIdentity(client, scope, customerId, "email", identity.email, true, identitySource);
  await addIdentity(client, scope, customerId, "phone", identity.phone, true, identitySource);

  await client.query(
    `UPDATE tickets
     SET customer_id = $2,
         updated_at = now()
     WHERE id = $1
       AND tenant_key = $3
       AND workspace_key = $4
       AND customer_id IS NULL`,
    [ticket.id, customerId, scope.tenantKey, scope.workspaceKey]
  );

  return {
    linked: true,
    createdCustomer,
    source: identity.externalUserId ? "external_or_identity" : "identity"
  };
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }

  const limit = parseInteger(process.env.CUSTOMER_RECONCILE_LIMIT, 500);
  const dryRun = parseBoolean(process.env.CUSTOMER_RECONCILE_DRY_RUN, true);
  const scope = parseReconcileScope();

  const pool = new Pool({ connectionString });
  const client = await pool.connect();

  const counters = {
    scanned: 0,
    linked: 0,
    createdCustomers: 0,
    unresolved: 0,
    failed: 0
  };

  try {
    const ticketsResult = await client.query(
      `SELECT id, tenant_key, workspace_key, requester_email, metadata
       FROM tickets
       WHERE tenant_key = $1
         AND workspace_key = $2
         AND customer_id IS NULL
         AND merged_into_ticket_id IS NULL
       ORDER BY created_at ASC
       LIMIT $3`,
      [scope.tenantKey, scope.workspaceKey, limit]
    );

    console.log(
      `[customer-reconcile] mode=${dryRun ? "dry-run" : "apply"} scope=${scope.tenantKey}:${scope.workspaceKey} tickets=${ticketsResult.rowCount}`
    );

    for (const ticket of ticketsResult.rows) {
      counters.scanned += 1;

      try {
        if (!dryRun) await client.query("BEGIN");
        const result = await reconcileTicket(client, ticket, dryRun, scope);

        if (result.linked) {
          counters.linked += 1;
        } else {
          counters.unresolved += 1;
        }

        if (result.createdCustomer) {
          counters.createdCustomers += 1;
        }

        if (!dryRun) await client.query("COMMIT");
      } catch (error) {
        if (!dryRun) await client.query("ROLLBACK");
        counters.failed += 1;
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[customer-reconcile] ticket=${ticket.id} failed: ${message}`);
      }
    }

    console.log("[customer-reconcile] summary:", counters);
  } finally {
    client.release();
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  addIdentity,
  createUnregisteredCustomer,
  deriveTicketIdentity,
  findCustomerByExternal,
  findCustomerByIdentity,
  parseReconcileScope,
  reconcileTicket
};
