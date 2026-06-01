import { db } from "@/server/db";
import type { PredictionProfile } from "@/server/integrations/prediction-profile";
import { normalizeLinkEmail, normalizeLinkPhone } from "@/server/integrations/external-user-links";
import { resolveTenantScope, type TenantScopeInput } from "@/server/tenant-context";

export type CustomerKind = "registered" | "unregistered";

export type CustomerRecord = {
  id: string;
  tenant_key?: string;
  workspace_key?: string;
  kind: CustomerKind;
  external_system: string | null;
  external_user_id: string | null;
  display_name: string | null;
  primary_email: string | null;
  primary_phone: string | null;
  address: string | null;
  merged_into_customer_id: string | null;
  merged_at: string | null;
};

export type CustomerIdentityRecord = {
  identity_type: "email" | "phone";
  identity_value: string;
  is_primary: boolean;
};

export type CustomerHistoryItem = {
  ticketId: string;
  ticketNumber: number | null;
  subject: string | null;
  status: string;
  priority: string;
  requesterEmail: string;
  channel: "email" | "whatsapp" | "voice";
  lastMessageAt: string | null;
  lastCustomerInboundPreview: string | null;
  lastCustomerInboundAt: string | null;
};

export type CustomerHistoryPage = {
  items: CustomerHistoryItem[];
  nextCursor: string | null;
};

export type CustomerResolutionConflict = {
  type: "external_identity_conflict";
  externalSystem: string;
  incomingExternalUserId: string;
  existingExternalUserId: string | null;
  existingExternalSystem: string | null;
  existingCustomerId: string;
  matchedIdentity: "email" | "phone" | "email_or_phone" | "unknown";
};

export type CustomerResolution = {
  customerId: string;
  kind: CustomerKind;
  conflict?: CustomerResolutionConflict;
};

export class CustomerIdentityConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CustomerIdentityConflictError";
  }
}

type Queryable = {
  query: typeof db.query;
};

async function upsertCustomerIdentity({
  tenantKey,
  workspaceKey,
  customerId,
  identityType,
  identityValue,
  isPrimary,
  source,
  queryable = db
}: {
  tenantKey: string;
  workspaceKey: string;
  customerId: string;
  identityType: "email" | "phone";
  identityValue: string;
  isPrimary: boolean;
  source: string;
  queryable?: Queryable;
}) {
  await queryable.query(
    `INSERT INTO customer_identities (
      tenant_key, workspace_key, customer_id, identity_type, identity_value, is_primary, source, updated_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, now()
    )
    ON CONFLICT (tenant_key, identity_type, identity_value)
    DO UPDATE SET
      is_primary =
        CASE
          WHEN customer_identities.customer_id = EXCLUDED.customer_id
            THEN customer_identities.is_primary OR EXCLUDED.is_primary
          ELSE customer_identities.is_primary
        END,
      source =
        CASE
          WHEN customer_identities.customer_id = EXCLUDED.customer_id
            THEN EXCLUDED.source
          ELSE customer_identities.source
        END,
      updated_at =
        CASE
          WHEN customer_identities.customer_id = EXCLUDED.customer_id
            THEN now()
          ELSE customer_identities.updated_at
        END`,
    [tenantKey, workspaceKey, customerId, identityType, identityValue, isPrimary, source]
  );
}

async function findCanonicalCustomerByIdentity({
  tenantKey,
  email,
  phone,
  queryable = db
}: {
  tenantKey: string;
  email: string | null;
  phone: string | null;
  queryable?: Queryable;
}) {
  const conditions: string[] = [];
  const values: string[] = [tenantKey];

  if (email) {
    values.push("email", email);
    const typePlaceholder = `$${values.length - 1}`;
    const valuePlaceholder = `$${values.length}`;
    conditions.push(
      `(ci.identity_type = ${typePlaceholder} AND ci.identity_value = ${valuePlaceholder})`
    );
  }

  if (phone) {
    values.push("phone", phone);
    const typePlaceholder = `$${values.length - 1}`;
    const valuePlaceholder = `$${values.length}`;
    conditions.push(
      `(ci.identity_type = ${typePlaceholder} AND ci.identity_value = ${valuePlaceholder})`
    );
  }

  if (conditions.length === 0) {
    return null;
  }

  const result = await queryable.query<{
    id: string;
    kind: CustomerKind;
    external_system: string | null;
    external_user_id: string | null;
  }>(
    `SELECT c.id, c.kind, c.external_system, c.external_user_id
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

  return result.rows[0] ?? null;
}

async function findCustomerByExternalRef({
  tenantKey,
  externalSystem,
  externalUserId,
  queryable = db
}: {
  tenantKey: string;
  externalSystem: string;
  externalUserId: string;
  queryable?: Queryable;
}) {
  const result = await queryable.query<{
    id: string;
    kind: CustomerKind;
    external_system: string | null;
    external_user_id: string | null;
  }>(
    `SELECT id, kind, external_system, external_user_id
     FROM customers
     WHERE tenant_key = $1
       AND merged_into_customer_id IS NULL
       AND external_system = $2
       AND external_user_id = $3
     LIMIT 1`,
    [tenantKey, externalSystem, externalUserId]
  );

  return result.rows[0] ?? null;
}

async function createUnregisteredCustomer({
  tenantKey,
  workspaceKey,
  displayName,
  email,
  phone,
  queryable = db
}: {
  tenantKey: string;
  workspaceKey: string;
  displayName: string | null;
  email: string | null;
  phone: string | null;
  queryable?: Queryable;
}) {
  const result = await queryable.query<{ id: string }>(
    `INSERT INTO customers (
       tenant_key, workspace_key, kind, display_name, primary_email, primary_phone
     )
     VALUES ($1, $2, 'unregistered', $3, $4, $5)
     RETURNING id`,
    [tenantKey, workspaceKey, displayName, email, phone]
  );
  return result.rows[0].id;
}

async function upsertRegisteredCustomer({
  tenantKey,
  workspaceKey,
  externalSystem,
  profile,
  email,
  phone,
  displayName,
  queryable = db
}: {
  tenantKey: string;
  workspaceKey: string;
  externalSystem: string;
  profile: PredictionProfile;
  email: string | null;
  phone: string | null;
  displayName: string | null;
  queryable?: Queryable;
}) {
  const preferredEmail = normalizeLinkEmail(profile.email) ?? email;
  const preferredPhone = normalizeLinkPhone(profile.phoneNumber) ?? phone;

  const result = await queryable.query<{ id: string }>(
    `INSERT INTO customers (
      tenant_key,
      workspace_key,
      kind,
      external_system,
      external_user_id,
      display_name,
      primary_email,
      primary_phone
    ) VALUES (
      $1, $2, 'registered', $3, $4, $5, $6, $7
    )
    ON CONFLICT (tenant_key, external_system, external_user_id)
    DO UPDATE SET
      display_name = COALESCE(EXCLUDED.display_name, customers.display_name),
      primary_email = COALESCE(EXCLUDED.primary_email, customers.primary_email),
      primary_phone = COALESCE(EXCLUDED.primary_phone, customers.primary_phone),
      updated_at = now()
    RETURNING id`,
    [
      tenantKey,
      workspaceKey,
      externalSystem,
      profile.id,
      profile.fullName ?? displayName,
      preferredEmail,
      preferredPhone
    ]
  );

  return result.rows[0].id;
}

async function promoteCustomerWithProfile({
  tenantKey,
  customerId,
  externalSystem,
  profile,
  email,
  phone,
  displayName,
  queryable = db
}: {
  tenantKey: string;
  customerId: string;
  externalSystem: string;
  profile: PredictionProfile;
  email: string | null;
  phone: string | null;
  displayName: string | null;
  queryable?: Queryable;
}) {
  const preferredEmail = normalizeLinkEmail(profile.email) ?? email;
  const preferredPhone = normalizeLinkPhone(profile.phoneNumber) ?? phone;

  const result = await queryable.query<{ id: string }>(
    `UPDATE customers
     SET kind = 'registered',
         external_system = CASE
           WHEN external_system IS NULL OR external_system = $2 THEN $2
           ELSE external_system
         END,
         external_user_id = CASE
           WHEN external_system IS NULL OR external_system = $2 THEN $3
           ELSE external_user_id
         END,
         display_name = COALESCE($4, display_name),
         primary_email = COALESCE($5, primary_email),
         primary_phone = COALESCE($6, primary_phone),
         updated_at = now()
     WHERE id = $1
       AND tenant_key = $7
     RETURNING id`,
    [
      customerId,
      externalSystem,
      profile.id,
      profile.fullName ?? displayName,
      preferredEmail,
      preferredPhone,
      tenantKey
    ]
  );

  return result.rows[0]?.id ?? customerId;
}

export async function resolveOrCreateCustomerForInbound({
  tenantKey,
  workspaceKey,
  externalSystem = "prediction-market-mvp",
  profile,
  inboundEmail,
  inboundPhone,
  displayName
}: {
  tenantKey?: string | null;
  workspaceKey?: string | null;
  externalSystem?: string;
  profile?: PredictionProfile | null;
  inboundEmail?: string | null;
  inboundPhone?: string | null;
  displayName?: string | null;
}): Promise<CustomerResolution | null> {
  const scope = resolveTenantScope({ tenantKey, workspaceKey });
  const normalizedEmail = normalizeLinkEmail(inboundEmail ?? undefined);
  const normalizedPhone = normalizeLinkPhone(inboundPhone ?? undefined);

  if (!profile && !normalizedEmail && !normalizedPhone) {
    return null;
  }

  let customerId: string;
  let kind: CustomerKind;
  let conflict: CustomerResolutionConflict | undefined;
  const profileEmail = profile ? normalizeLinkEmail(profile.email) : null;
  const profilePhone = profile ? normalizeLinkPhone(profile.phoneNumber) : null;
  const primaryEmail = profileEmail ?? normalizedEmail;
  const primaryPhone = profilePhone ?? normalizedPhone;
  const matchedIdentity: CustomerResolutionConflict["matchedIdentity"] =
    normalizedEmail && normalizedPhone
      ? "email_or_phone"
      : normalizedEmail
        ? "email"
        : normalizedPhone
          ? "phone"
          : "unknown";
  const client = await db.connect();
  try {
    await client.query("BEGIN");

    if (profile) {
      const registeredCustomer = await findCustomerByExternalRef({
        tenantKey: scope.tenantKey,
        externalSystem,
        externalUserId: profile.id,
        queryable: client
      });
      const canonical = await findCanonicalCustomerByIdentity({
        tenantKey: scope.tenantKey,
        email: primaryEmail,
        phone: primaryPhone,
        queryable: client
      });

      if (canonical && registeredCustomer && canonical.id !== registeredCustomer.id) {
        customerId = canonical.id;
        kind = canonical.kind;
        conflict = {
          type: "external_identity_conflict",
          externalSystem,
          incomingExternalUserId: profile.id,
          existingExternalUserId: canonical.external_user_id ?? registeredCustomer.external_user_id,
          existingExternalSystem: canonical.external_system ?? registeredCustomer.external_system,
          existingCustomerId: canonical.id,
          matchedIdentity
        };
      } else if (registeredCustomer) {
        customerId = await promoteCustomerWithProfile({
          tenantKey: scope.tenantKey,
          customerId: registeredCustomer.id,
          externalSystem,
          profile,
          email: normalizedEmail,
          phone: normalizedPhone,
          displayName: displayName ?? null,
          queryable: client
        });
        kind = "registered";
      } else if (canonical && canonical.kind === "unregistered") {
        customerId = await promoteCustomerWithProfile({
          tenantKey: scope.tenantKey,
          customerId: canonical.id,
          externalSystem,
          profile,
          email: normalizedEmail,
          phone: normalizedPhone,
          displayName: displayName ?? null,
          queryable: client
        });
        kind = "registered";
      } else if (canonical && canonical.kind === "registered") {
        customerId = canonical.id;
        kind = canonical.kind;
        conflict = {
          type: "external_identity_conflict",
          externalSystem,
          incomingExternalUserId: profile.id,
          existingExternalUserId: canonical.external_user_id,
          existingExternalSystem: canonical.external_system,
          existingCustomerId: canonical.id,
          matchedIdentity
        };
      } else {
        customerId = await upsertRegisteredCustomer({
          tenantKey: scope.tenantKey,
          workspaceKey: scope.workspaceKey,
          externalSystem,
          profile,
          email: normalizedEmail,
          phone: normalizedPhone,
          displayName: displayName ?? null,
          queryable: client
        });
        kind = "registered";
      }
    } else {
      const existing = await findCanonicalCustomerByIdentity({
        tenantKey: scope.tenantKey,
        email: normalizedEmail,
        phone: normalizedPhone,
        queryable: client
      });

      if (existing) {
        customerId = existing.id;
        kind = existing.kind;
      } else {
        customerId = await createUnregisteredCustomer({
          tenantKey: scope.tenantKey,
          workspaceKey: scope.workspaceKey,
          displayName: displayName ?? null,
          email: normalizedEmail,
          phone: normalizedPhone,
          queryable: client
        });
        kind = "unregistered";
      }
    }

    const identityEmail = conflict ? normalizedEmail : primaryEmail;
    const identityPhone = conflict ? normalizedPhone : primaryPhone;

    if (identityEmail) {
      await upsertCustomerIdentity({
        customerId,
        tenantKey: scope.tenantKey,
        workspaceKey: scope.workspaceKey,
        identityType: "email",
        identityValue: identityEmail,
        isPrimary: true,
        source: profile ? "profile_lookup" : "inbound_email",
        queryable: client
      });
    }

    if (identityPhone) {
      await upsertCustomerIdentity({
        customerId,
        tenantKey: scope.tenantKey,
        workspaceKey: scope.workspaceKey,
        identityType: "phone",
        identityValue: identityPhone,
        isPrimary: true,
        source: profile ? "profile_lookup" : "inbound_whatsapp",
        queryable: client
      });
    }

    if (normalizedEmail && normalizedEmail !== identityEmail) {
      await upsertCustomerIdentity({
        customerId,
        tenantKey: scope.tenantKey,
        workspaceKey: scope.workspaceKey,
        identityType: "email",
        identityValue: normalizedEmail,
        isPrimary: false,
        source: "inbound_email",
        queryable: client
      });
    }

    if (normalizedPhone && normalizedPhone !== identityPhone) {
      await upsertCustomerIdentity({
        customerId,
        tenantKey: scope.tenantKey,
        workspaceKey: scope.workspaceKey,
        identityType: "phone",
        identityValue: normalizedPhone,
        isPrimary: false,
        source: "inbound_whatsapp",
        queryable: client
      });
    }

    await client.query("COMMIT");
    return { customerId, kind, conflict };
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    throw error;
  } finally {
    client.release();
  }
}

export async function attachCustomerToTicket(
  ticketId: string,
  customerId: string | null,
  scopeInput?: TenantScopeInput
) {
  if (!customerId) return false;
  const { tenantKey } = resolveTenantScope(scopeInput);
  const result = await db.query(
    `UPDATE tickets
     SET customer_id = $2,
         updated_at = now()
     WHERE id = $1
       AND tenant_key = $3
       AND customer_id IS NULL`,
    [ticketId, customerId, tenantKey]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function getCustomerByTicketId(ticketId: string, scopeInput?: TenantScopeInput) {
  const { tenantKey } = resolveTenantScope(scopeInput);
  const result = await db.query<{ customer_id: string | null }>(
    `SELECT customer_id
     FROM tickets
     WHERE id = $1
       AND tenant_key = $2`,
    [ticketId, tenantKey]
  );
  return result.rows[0]?.customer_id ?? null;
}

export async function getCustomerById(customerId: string, scopeInput?: TenantScopeInput) {
  const { tenantKey } = resolveTenantScope(scopeInput);
  const result = await db.query<CustomerRecord>(
    `SELECT id, tenant_key, workspace_key,
            kind, external_system, external_user_id, display_name, primary_email, primary_phone,
            address,
            merged_into_customer_id,
            merged_at
     FROM customers
     WHERE id = $1
       AND tenant_key = $2`,
    [customerId, tenantKey]
  );
  return result.rows[0] ?? null;
}

export async function updateCustomerProfile(
  customerId: string,
  input: {
    displayName?: string | null;
    primaryEmail?: string | null;
    primaryPhone?: string | null;
    address?: string | null;
  },
  scopeInput?: TenantScopeInput
) {
  const { tenantKey, workspaceKey } = resolveTenantScope(scopeInput);
  const displayNameProvided = Object.prototype.hasOwnProperty.call(input, "displayName");
  const emailProvided = Object.prototype.hasOwnProperty.call(input, "primaryEmail");
  const phoneProvided = Object.prototype.hasOwnProperty.call(input, "primaryPhone");
  const addressProvided = Object.prototype.hasOwnProperty.call(input, "address");

  if (!displayNameProvided && !emailProvided && !phoneProvided && !addressProvided) {
    return getCustomerById(customerId, { tenantKey, workspaceKey });
  }

  const normalizedEmail = emailProvided
    ? normalizeLinkEmail(input.primaryEmail ?? undefined)
    : undefined;
  const normalizedPhone = phoneProvided
    ? normalizeLinkPhone(input.primaryPhone ?? undefined)
    : undefined;
  const normalizedDisplayName = displayNameProvided
    ? (input.displayName?.trim() || null)
    : undefined;
  const normalizedAddress = addressProvided ? (input.address?.trim() || null) : undefined;

  const client = await db.connect();
  try {
    await client.query("BEGIN");

    const customerResult = await client.query<CustomerRecord>(
      `SELECT id, kind, external_system, external_user_id, display_name, primary_email, primary_phone,
              address,
              merged_into_customer_id,
              merged_at
       FROM customers
       WHERE id = $1
         AND tenant_key = $2
       FOR UPDATE`,
      [customerId, tenantKey]
    );
    const customer = customerResult.rows[0];
    if (!customer) {
      await client.query("ROLLBACK");
      return null;
    }
    if (customer.merged_into_customer_id) {
      await client.query("ROLLBACK");
      throw new Error("Cannot edit a merged customer profile.");
    }

    if (emailProvided && normalizedEmail) {
      const conflict = await client.query<{ customer_id: string }>(
        `SELECT customer_id
         FROM customer_identities
         WHERE tenant_key = $1
           AND identity_type = 'email'
           AND identity_value = $2
         LIMIT 1`,
        [tenantKey, normalizedEmail]
      );
      if (conflict.rows[0] && conflict.rows[0].customer_id !== customerId) {
        await client.query("ROLLBACK");
        throw new CustomerIdentityConflictError("Email already belongs to a different customer.");
      }
    }

    if (phoneProvided && normalizedPhone) {
      const conflict = await client.query<{ customer_id: string }>(
        `SELECT customer_id
         FROM customer_identities
         WHERE tenant_key = $1
           AND identity_type = 'phone'
           AND identity_value = $2
         LIMIT 1`,
        [tenantKey, normalizedPhone]
      );
      if (conflict.rows[0] && conflict.rows[0].customer_id !== customerId) {
        await client.query("ROLLBACK");
        throw new CustomerIdentityConflictError("Phone number already belongs to a different customer.");
      }
    }

    const fields: string[] = [];
    const values: Array<string | null> = [];
    let index = 1;

    if (displayNameProvided) {
      fields.push(`display_name = $${index++}`);
      values.push(normalizedDisplayName ?? null);
    }
    if (emailProvided) {
      fields.push(`primary_email = $${index++}`);
      values.push(normalizedEmail ?? null);
    }
    if (phoneProvided) {
      fields.push(`primary_phone = $${index++}`);
      values.push(normalizedPhone ?? null);
    }
    if (addressProvided) {
      fields.push(`address = $${index++}`);
      values.push(normalizedAddress ?? null);
    }

    if (fields.length > 0) {
      values.push(customerId);
      values.push(tenantKey);
      await client.query(
        `UPDATE customers
         SET ${fields.join(", ")},
             updated_at = now()
         WHERE id = $${index}
           AND tenant_key = $${index + 1}`,
        values
      );
    }

    if (emailProvided) {
      await client.query(
        `UPDATE customer_identities
         SET is_primary = false,
             updated_at = now()
         WHERE customer_id = $1
           AND tenant_key = $2
           AND identity_type = 'email'`,
        [customerId, tenantKey]
      );
      if (normalizedEmail) {
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
           ) VALUES ($1, $2, $3, 'email', $4, true, 'manual_profile_edit', now())
           ON CONFLICT (tenant_key, identity_type, identity_value)
           DO UPDATE SET
             customer_id = EXCLUDED.customer_id,
             is_primary = true,
             source = EXCLUDED.source,
             updated_at = now()`,
          [tenantKey, workspaceKey, customerId, normalizedEmail]
        );
      }
    }

    if (phoneProvided) {
      await client.query(
        `UPDATE customer_identities
         SET is_primary = false,
             updated_at = now()
         WHERE customer_id = $1
           AND tenant_key = $2
           AND identity_type = 'phone'`,
        [customerId, tenantKey]
      );
      if (normalizedPhone) {
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
           ) VALUES ($1, $2, $3, 'phone', $4, true, 'manual_profile_edit', now())
           ON CONFLICT (tenant_key, identity_type, identity_value)
           DO UPDATE SET
             customer_id = EXCLUDED.customer_id,
             is_primary = true,
             source = EXCLUDED.source,
             updated_at = now()`,
          [tenantKey, workspaceKey, customerId, normalizedPhone]
        );
      }
    }

    await client.query("COMMIT");
    return getCustomerById(customerId, { tenantKey, workspaceKey });
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    throw error;
  } finally {
    client.release();
  }
}

export async function listCustomerIdentities(customerId: string, scopeInput?: TenantScopeInput) {
  const { tenantKey } = resolveTenantScope(scopeInput);
  const result = await db.query<CustomerIdentityRecord>(
    `SELECT identity_type, identity_value, is_primary
     FROM customer_identities
     WHERE customer_id = $1
       AND tenant_key = $2
     ORDER BY is_primary DESC, identity_type ASC, identity_value ASC`,
    [customerId, tenantKey]
  );
  return result.rows;
}

export async function listCustomerHistory(
  customerId: string,
  options?: { limit?: number; cursor?: string | null },
  scopeInput?: TenantScopeInput
): Promise<CustomerHistoryPage> {
  const { tenantKey } = resolveTenantScope(scopeInput);
  const normalizedLimit = Math.min(Math.max(options?.limit ?? 40, 1), 200);
  const fetchLimit = normalizedLimit + 1;
  const cursorValue = options?.cursor ?? null;
  const cursorDate = cursorValue ? new Date(cursorValue) : null;
  const cursorIso =
    cursorDate && !Number.isNaN(cursorDate.getTime()) ? cursorDate.toISOString() : null;
  const customer = await getCustomerById(customerId, { tenantKey });
  if (!customer || customer.merged_into_customer_id) {
    return { items: [], nextCursor: null };
  }

  const identityResult = await db.query<{
    identity_type: "email" | "phone";
    identity_value: string;
  }>(
    `SELECT identity_type, identity_value
     FROM customer_identities
     WHERE customer_id = $1
       AND tenant_key = $2`,
    [customerId, tenantKey]
  );

  const emails = identityResult.rows
    .filter((row) => row.identity_type === "email")
    .map((row) => row.identity_value.toLowerCase());
  const phones = identityResult.rows
    .filter((row) => row.identity_type === "phone")
    .map((row) => row.identity_value);

  if (customer.primary_email && !emails.includes(customer.primary_email.toLowerCase())) {
    emails.push(customer.primary_email.toLowerCase());
  }
  if (customer.primary_phone && !phones.includes(customer.primary_phone)) {
    phones.push(customer.primary_phone);
  }

  const historyResult = await db.query<{
    id: string;
    ticket_number: number | null;
    subject: string | null;
    status: string;
    priority: string;
    requester_email: string;
    has_whatsapp: boolean;
    has_voice: boolean;
    last_message_at: Date | null;
    last_customer_inbound_preview: string | null;
    last_customer_inbound_at: Date | null;
  }>(
    `WITH ticket_history AS (
       SELECT
         t.id,
         t.ticket_number,
         t.subject,
         t.status,
         t.priority,
         t.requester_email,
         EXISTS (
           SELECT 1 FROM messages wm
           WHERE wm.ticket_id = t.id AND wm.tenant_key = $1 AND wm.channel = 'whatsapp'
         ) OR t.requester_email ILIKE 'whatsapp:%' AS has_whatsapp,
         EXISTS (
           SELECT 1 FROM messages vm
           WHERE vm.ticket_id = t.id AND vm.tenant_key = $1 AND vm.channel = 'voice'
         ) OR t.requester_email ILIKE 'voice:%' AS has_voice,
         COALESCE(MAX(COALESCE(m.received_at, m.sent_at, m.created_at)), t.updated_at, t.created_at) AS last_message_at,
         COALESCE(
           (
             SELECT im.preview_text
             FROM messages im
             WHERE im.ticket_id = t.id
               AND im.tenant_key = $1
               AND im.direction = 'inbound'
               AND (
                 (cardinality($3::text[]) > 0 AND lower(im.from_email) = ANY($3::text[]))
                 OR (
                   cardinality($4::text[]) > 0
                   AND (
                     regexp_replace(im.from_email, '[^0-9+]', '', 'g') = ANY($4::text[])
                     OR COALESCE(im.wa_contact, '') = ANY($4::text[])
                   )
                 )
               )
             ORDER BY COALESCE(im.received_at, im.sent_at, im.created_at) DESC
             LIMIT 1
           ),
           (
             SELECT im.preview_text
             FROM messages im
             WHERE im.ticket_id = t.id
               AND im.tenant_key = $1
               AND im.direction = 'inbound'
             ORDER BY COALESCE(im.received_at, im.sent_at, im.created_at) DESC
             LIMIT 1
           )
         ) AS last_customer_inbound_preview,
         COALESCE(
           (
             SELECT COALESCE(im.received_at, im.sent_at, im.created_at)
             FROM messages im
             WHERE im.ticket_id = t.id
               AND im.tenant_key = $1
               AND im.direction = 'inbound'
               AND (
                 (cardinality($3::text[]) > 0 AND lower(im.from_email) = ANY($3::text[]))
                 OR (
                   cardinality($4::text[]) > 0
                   AND (
                     regexp_replace(im.from_email, '[^0-9+]', '', 'g') = ANY($4::text[])
                     OR COALESCE(im.wa_contact, '') = ANY($4::text[])
                   )
                 )
               )
             ORDER BY COALESCE(im.received_at, im.sent_at, im.created_at) DESC
             LIMIT 1
           ),
           (
             SELECT COALESCE(im.received_at, im.sent_at, im.created_at)
             FROM messages im
             WHERE im.ticket_id = t.id
               AND im.tenant_key = $1
               AND im.direction = 'inbound'
             ORDER BY COALESCE(im.received_at, im.sent_at, im.created_at) DESC
             LIMIT 1
           )
         ) AS last_customer_inbound_at
       FROM tickets t
       LEFT JOIN messages m ON m.ticket_id = t.id AND m.tenant_key = t.tenant_key
       WHERE t.tenant_key = $1
         AND t.customer_id = $2
         AND t.merged_into_ticket_id IS NULL
       GROUP BY t.id
     )
     SELECT
       id,
       ticket_number,
       subject,
       status,
       priority,
       requester_email,
       has_whatsapp,
       has_voice,
       last_message_at,
       last_customer_inbound_preview,
       last_customer_inbound_at
     FROM ticket_history
     WHERE ($5::timestamptz IS NULL OR last_message_at < $5::timestamptz)
     ORDER BY last_message_at DESC NULLS LAST, id DESC
     LIMIT $6`,
    [tenantKey, customerId, emails, phones, cursorIso, fetchLimit]
  );

  const mapped = historyResult.rows.map((row) => ({
    ticketId: row.id,
    ticketNumber: row.ticket_number,
    subject: row.subject,
    status: row.status,
    priority: row.priority,
    requesterEmail: row.requester_email,
    channel: row.has_whatsapp
      ? ("whatsapp" as const)
      : row.has_voice
        ? ("voice" as const)
        : ("email" as const),
    lastMessageAt: row.last_message_at ? row.last_message_at.toISOString() : null,
    lastCustomerInboundPreview: row.last_customer_inbound_preview ?? null,
    lastCustomerInboundAt: row.last_customer_inbound_at
      ? row.last_customer_inbound_at.toISOString()
      : null
  }));

  const hasMore = mapped.length > normalizedLimit;
  const items = hasMore ? mapped.slice(0, normalizedLimit) : mapped;
  const nextCursor = hasMore ? (items[items.length - 1]?.lastMessageAt ?? null) : null;

  return { items, nextCursor };
}
