import { db } from "@/server/db";
import type { PredictionProfile } from "@/server/integrations/prediction-profile";
import { normalizeLinkEmail, normalizeLinkPhone } from "@/server/integrations/external-user-links";

export type CustomerKind = "registered" | "unregistered";

export type CustomerRecord = {
  id: string;
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

export class CustomerIdentityConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CustomerIdentityConflictError";
  }
}

async function upsertCustomerIdentity({
  customerId,
  identityType,
  identityValue,
  isPrimary,
  source
}: {
  customerId: string;
  identityType: "email" | "phone";
  identityValue: string;
  isPrimary: boolean;
  source: string;
}) {
  await db.query(
    `INSERT INTO customer_identities (
      customer_id, identity_type, identity_value, is_primary, source, updated_at
    ) VALUES (
      $1, $2, $3, $4, $5, now()
    )
    ON CONFLICT (identity_type, identity_value)
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
    [customerId, identityType, identityValue, isPrimary, source]
  );
}

async function findCanonicalCustomerByIdentity({
  email,
  phone
}: {
  email: string | null;
  phone: string | null;
}) {
  const conditions: string[] = [];
  const values: string[] = [];

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

  const result = await db.query<{ id: string; kind: CustomerKind }>(
    `SELECT c.id, c.kind
     FROM customer_identities ci
     JOIN customers c ON c.id = ci.customer_id
     WHERE c.merged_into_customer_id IS NULL
       AND (${conditions.join(" OR ")})
     ORDER BY CASE c.kind WHEN 'registered' THEN 0 ELSE 1 END, c.created_at ASC
     LIMIT 1`,
    values
  );

  return result.rows[0] ?? null;
}

async function createUnregisteredCustomer({
  displayName,
  email,
  phone
}: {
  displayName: string | null;
  email: string | null;
  phone: string | null;
}) {
  const result = await db.query<{ id: string }>(
    `INSERT INTO customers (kind, display_name, primary_email, primary_phone)
     VALUES ('unregistered', $1, $2, $3)
     RETURNING id`,
    [displayName, email, phone]
  );
  return result.rows[0].id;
}

async function upsertRegisteredCustomer({
  externalSystem,
  profile,
  email,
  phone,
  displayName
}: {
  externalSystem: string;
  profile: PredictionProfile;
  email: string | null;
  phone: string | null;
  displayName: string | null;
}) {
  const preferredEmail = normalizeLinkEmail(profile.email) ?? email;
  const preferredPhone = normalizeLinkPhone(profile.phoneNumber) ?? phone;

  const result = await db.query<{ id: string }>(
    `INSERT INTO customers (
      kind,
      external_system,
      external_user_id,
      display_name,
      primary_email,
      primary_phone
    ) VALUES (
      'registered', $1, $2, $3, $4, $5
    )
    ON CONFLICT (external_system, external_user_id)
    DO UPDATE SET
      display_name = COALESCE(EXCLUDED.display_name, customers.display_name),
      primary_email = COALESCE(EXCLUDED.primary_email, customers.primary_email),
      primary_phone = COALESCE(EXCLUDED.primary_phone, customers.primary_phone),
      updated_at = now()
    RETURNING id`,
    [
      externalSystem,
      profile.id,
      profile.fullName ?? displayName,
      preferredEmail,
      preferredPhone
    ]
  );

  return result.rows[0].id;
}

export async function resolveOrCreateCustomerForInbound({
  externalSystem = "prediction-market-mvp",
  profile,
  inboundEmail,
  inboundPhone,
  displayName
}: {
  externalSystem?: string;
  profile?: PredictionProfile | null;
  inboundEmail?: string | null;
  inboundPhone?: string | null;
  displayName?: string | null;
}) {
  const normalizedEmail = normalizeLinkEmail(inboundEmail ?? undefined);
  const normalizedPhone = normalizeLinkPhone(inboundPhone ?? undefined);

  if (!profile && !normalizedEmail && !normalizedPhone) {
    return null;
  }

  let customerId: string;
  let kind: CustomerKind;

  if (profile) {
    customerId = await upsertRegisteredCustomer({
      externalSystem,
      profile,
      email: normalizedEmail,
      phone: normalizedPhone,
      displayName: displayName ?? null
    });
    kind = "registered";
  } else {
    const existing = await findCanonicalCustomerByIdentity({
      email: normalizedEmail,
      phone: normalizedPhone
    });

    if (existing) {
      customerId = existing.id;
      kind = existing.kind;
    } else {
      customerId = await createUnregisteredCustomer({
        displayName: displayName ?? null,
        email: normalizedEmail,
        phone: normalizedPhone
      });
      kind = "unregistered";
    }
  }

  const profileEmail = profile ? normalizeLinkEmail(profile.email) : null;
  const profilePhone = profile ? normalizeLinkPhone(profile.phoneNumber) : null;
  const primaryEmail = profileEmail ?? normalizedEmail;
  const primaryPhone = profilePhone ?? normalizedPhone;

  if (primaryEmail) {
    await upsertCustomerIdentity({
      customerId,
      identityType: "email",
      identityValue: primaryEmail,
      isPrimary: true,
      source: profile ? "profile_lookup" : "inbound_email"
    });
  }

  if (primaryPhone) {
    await upsertCustomerIdentity({
      customerId,
      identityType: "phone",
      identityValue: primaryPhone,
      isPrimary: true,
      source: profile ? "profile_lookup" : "inbound_whatsapp"
    });
  }

  if (normalizedEmail && normalizedEmail !== primaryEmail) {
    await upsertCustomerIdentity({
      customerId,
      identityType: "email",
      identityValue: normalizedEmail,
      isPrimary: false,
      source: "inbound_email"
    });
  }

  if (normalizedPhone && normalizedPhone !== primaryPhone) {
    await upsertCustomerIdentity({
      customerId,
      identityType: "phone",
      identityValue: normalizedPhone,
      isPrimary: false,
      source: "inbound_whatsapp"
    });
  }

  return { customerId, kind };
}

export async function attachCustomerToTicket(ticketId: string, customerId: string | null) {
  if (!customerId) return false;
  const result = await db.query(
    `UPDATE tickets
     SET customer_id = $2,
         updated_at = now()
     WHERE id = $1
       AND customer_id IS NULL`,
    [ticketId, customerId]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function getCustomerByTicketId(ticketId: string) {
  const result = await db.query<{ customer_id: string | null }>(
    `SELECT customer_id
     FROM tickets
     WHERE id = $1`,
    [ticketId]
  );
  return result.rows[0]?.customer_id ?? null;
}

export async function getCustomerById(customerId: string) {
  const result = await db.query<CustomerRecord>(
    `SELECT id, kind, external_system, external_user_id, display_name, primary_email, primary_phone,
            address,
            merged_into_customer_id,
            merged_at
     FROM customers
     WHERE id = $1`,
    [customerId]
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
  }
) {
  const displayNameProvided = Object.prototype.hasOwnProperty.call(input, "displayName");
  const emailProvided = Object.prototype.hasOwnProperty.call(input, "primaryEmail");
  const phoneProvided = Object.prototype.hasOwnProperty.call(input, "primaryPhone");
  const addressProvided = Object.prototype.hasOwnProperty.call(input, "address");

  if (!displayNameProvided && !emailProvided && !phoneProvided && !addressProvided) {
    return getCustomerById(customerId);
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
       FOR UPDATE`,
      [customerId]
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
         WHERE identity_type = 'email'
           AND identity_value = $1
         LIMIT 1`,
        [normalizedEmail]
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
         WHERE identity_type = 'phone'
           AND identity_value = $1
         LIMIT 1`,
        [normalizedPhone]
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
      await client.query(
        `UPDATE customers
         SET ${fields.join(", ")},
             updated_at = now()
         WHERE id = $${index}`,
        values
      );
    }

    if (emailProvided) {
      await client.query(
        `UPDATE customer_identities
         SET is_primary = false,
             updated_at = now()
         WHERE customer_id = $1
           AND identity_type = 'email'`,
        [customerId]
      );
      if (normalizedEmail) {
        await client.query(
          `INSERT INTO customer_identities (
             customer_id,
             identity_type,
             identity_value,
             is_primary,
             source,
             updated_at
           ) VALUES ($1, 'email', $2, true, 'manual_profile_edit', now())
           ON CONFLICT (identity_type, identity_value)
           DO UPDATE SET
             customer_id = EXCLUDED.customer_id,
             is_primary = true,
             source = EXCLUDED.source,
             updated_at = now()`,
          [customerId, normalizedEmail]
        );
      }
    }

    if (phoneProvided) {
      await client.query(
        `UPDATE customer_identities
         SET is_primary = false,
             updated_at = now()
         WHERE customer_id = $1
           AND identity_type = 'phone'`,
        [customerId]
      );
      if (normalizedPhone) {
        await client.query(
          `INSERT INTO customer_identities (
             customer_id,
             identity_type,
             identity_value,
             is_primary,
             source,
             updated_at
           ) VALUES ($1, 'phone', $2, true, 'manual_profile_edit', now())
           ON CONFLICT (identity_type, identity_value)
           DO UPDATE SET
             customer_id = EXCLUDED.customer_id,
             is_primary = true,
             source = EXCLUDED.source,
             updated_at = now()`,
          [customerId, normalizedPhone]
        );
      }
    }

    await client.query("COMMIT");
    return getCustomerById(customerId);
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    throw error;
  } finally {
    client.release();
  }
}

export async function listCustomerIdentities(customerId: string) {
  const result = await db.query<CustomerIdentityRecord>(
    `SELECT identity_type, identity_value, is_primary
     FROM customer_identities
     WHERE customer_id = $1
     ORDER BY is_primary DESC, identity_type ASC, identity_value ASC`,
    [customerId]
  );
  return result.rows;
}

export async function listCustomerHistory(
  customerId: string,
  options?: { limit?: number; cursor?: string | null }
): Promise<CustomerHistoryPage> {
  const normalizedLimit = Math.min(Math.max(options?.limit ?? 40, 1), 200);
  const fetchLimit = normalizedLimit + 1;
  const cursorValue = options?.cursor ?? null;
  const cursorDate = cursorValue ? new Date(cursorValue) : null;
  const cursorIso =
    cursorDate && !Number.isNaN(cursorDate.getTime()) ? cursorDate.toISOString() : null;
  const customer = await getCustomerById(customerId);
  if (!customer || customer.merged_into_customer_id) {
    return { items: [], nextCursor: null };
  }

  const identityResult = await db.query<{
    identity_type: "email" | "phone";
    identity_value: string;
  }>(
    `SELECT identity_type, identity_value
     FROM customer_identities
     WHERE customer_id = $1`,
    [customerId]
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
         t.subject,
         t.status,
         t.priority,
         t.requester_email,
         EXISTS (
           SELECT 1 FROM messages wm
           WHERE wm.ticket_id = t.id AND wm.channel = 'whatsapp'
         ) OR t.requester_email ILIKE 'whatsapp:%' AS has_whatsapp,
         EXISTS (
           SELECT 1 FROM messages vm
           WHERE vm.ticket_id = t.id AND vm.channel = 'voice'
         ) OR t.requester_email ILIKE 'voice:%' AS has_voice,
         COALESCE(MAX(COALESCE(m.received_at, m.sent_at, m.created_at)), t.updated_at, t.created_at) AS last_message_at,
         COALESCE(
           (
             SELECT im.preview_text
             FROM messages im
             WHERE im.ticket_id = t.id
               AND im.direction = 'inbound'
               AND (
                 (cardinality($2::text[]) > 0 AND lower(im.from_email) = ANY($2::text[]))
                 OR (
                   cardinality($3::text[]) > 0
                   AND (
                     regexp_replace(im.from_email, '[^0-9+]', '', 'g') = ANY($3::text[])
                     OR COALESCE(im.wa_contact, '') = ANY($3::text[])
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
               AND im.direction = 'inbound'
               AND (
                 (cardinality($2::text[]) > 0 AND lower(im.from_email) = ANY($2::text[]))
                 OR (
                   cardinality($3::text[]) > 0
                   AND (
                     regexp_replace(im.from_email, '[^0-9+]', '', 'g') = ANY($3::text[])
                     OR COALESCE(im.wa_contact, '') = ANY($3::text[])
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
               AND im.direction = 'inbound'
             ORDER BY COALESCE(im.received_at, im.sent_at, im.created_at) DESC
             LIMIT 1
           )
         ) AS last_customer_inbound_at
       FROM tickets t
       LEFT JOIN messages m ON m.ticket_id = t.id
       WHERE t.customer_id = $1
         AND t.merged_into_ticket_id IS NULL
       GROUP BY t.id
     )
     SELECT
       id,
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
     WHERE ($4::timestamptz IS NULL OR last_message_at < $4::timestamptz)
     ORDER BY last_message_at DESC NULLS LAST, id DESC
     LIMIT $5`,
    [customerId, emails, phones, cursorIso, fetchLimit]
  );

  const mapped = historyResult.rows.map((row) => ({
    ticketId: row.id,
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
