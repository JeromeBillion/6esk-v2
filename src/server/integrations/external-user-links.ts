import { db } from "@/server/db";
import type { ExternalProfile } from "@/server/integrations/external-profile";

type InboundChannel = "email" | "whatsapp";
type QueryExecutor = Pick<typeof db, "query">;

function requireTenantId(tenantId: string | null | undefined) {
  const scopedTenantId = tenantId?.trim();
  if (!scopedTenantId) {
    throw new Error("tenantId is required for external user links");
  }
  return scopedTenantId;
}

export function normalizeLinkEmail(value: string | null | undefined) {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  return normalized || null;
}

export function normalizeLinkPhone(value: string | null | undefined) {
  if (!value) return null;
  const normalized = value.replace(/[^\d+]/g, "").trim();
  return normalized || null;
}

export function deriveMatchConfidence(matchedBy: string | null | undefined) {
  if (!matchedBy) return null;
  switch (matchedBy) {
    case "email":
    case "secondary_email":
    case "phone":
    case "phone_number":
      return 1;
    case "closed_email_primary":
    case "closed_email_secondary":
      return 0.7;
    default:
      return null;
  }
}

export type ExternalUserLinkMatch = {
  tenant_id: string;
  external_system: string;
  external_user_id: string;
  email: string | null;
  phone: string | null;
  matched_by: string | null;
  confidence: number | null;
  last_seen_at: string;
  last_ticket_id: string | null;
  last_channel: InboundChannel | null;
};

export async function findExternalUserLinkByIdentity({
  tenantId,
  externalSystem,
  email,
  phone
}: {
  tenantId?: string | null;
  externalSystem: string;
  email?: string | null;
  phone?: string | null;
}) {
  const scopedTenantId = requireTenantId(tenantId);
  const normalizedEmail = normalizeLinkEmail(email);
  const normalizedPhone = normalizeLinkPhone(phone);

  if (!normalizedEmail && !normalizedPhone) {
    return null;
  }

  const result = await db.query<ExternalUserLinkMatch>(
    `SELECT
       tenant_id,
       external_system,
       external_user_id,
       email,
       phone,
       matched_by,
       confidence::float8 AS confidence,
       last_seen_at,
       last_ticket_id,
       last_channel
     FROM external_user_links
     WHERE tenant_id = $1
       AND external_system = $2
       AND (
         ($3::text IS NOT NULL AND LOWER(email) = $3::text)
         OR ($4::text IS NOT NULL AND phone = $4::text)
       )
     ORDER BY
       CASE
         WHEN $3::text IS NOT NULL
           AND LOWER(email) = $3::text
           AND $4::text IS NOT NULL
           AND phone = $4::text
           THEN 0
         WHEN $3::text IS NOT NULL AND LOWER(email) = $3::text
           THEN 1
         WHEN $4::text IS NOT NULL AND phone = $4::text
           THEN 2
         ELSE 3
       END ASC,
       confidence DESC NULLS LAST,
       last_seen_at DESC
     LIMIT 1`,
    [scopedTenantId, externalSystem, normalizedEmail, normalizedPhone]
  );

  return result.rows[0] ?? null;
}

export async function upsertExternalUserLink({
  tenantId,
  externalSystem,
  profile,
  matchedBy,
  inboundEmail,
  inboundPhone,
  ticketId,
  channel,
  queryExecutor = db
}: {
  tenantId?: string | null;
  externalSystem: string;
  profile: ExternalProfile;
  matchedBy?: string | null;
  inboundEmail?: string | null;
  inboundPhone?: string | null;
  ticketId: string;
  channel: InboundChannel;
  queryExecutor?: QueryExecutor;
}) {
  const scopedTenantId = requireTenantId(tenantId);
  const email = normalizeLinkEmail(inboundEmail) ?? normalizeLinkEmail(profile.email);
  const phone = normalizeLinkPhone(inboundPhone) ?? normalizeLinkPhone(profile.phoneNumber);

  if (!email && !phone) {
    return;
  }

  const confidence = deriveMatchConfidence(matchedBy);

  await queryExecutor.query(
    `INSERT INTO external_user_links (
      tenant_id,
      external_system,
      external_user_id,
      email,
      phone,
      matched_by,
      confidence,
      last_ticket_id,
      last_channel,
      last_seen_at,
      updated_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, now(), now()
    )
    ON CONFLICT (tenant_id, external_system, external_user_id)
    DO UPDATE SET
      email = COALESCE(EXCLUDED.email, external_user_links.email),
      phone = COALESCE(EXCLUDED.phone, external_user_links.phone),
      matched_by = COALESCE(EXCLUDED.matched_by, external_user_links.matched_by),
      confidence = COALESCE(EXCLUDED.confidence, external_user_links.confidence),
      last_ticket_id = COALESCE(EXCLUDED.last_ticket_id, external_user_links.last_ticket_id),
      last_channel = COALESCE(EXCLUDED.last_channel, external_user_links.last_channel),
      last_seen_at = GREATEST(external_user_links.last_seen_at, EXCLUDED.last_seen_at),
      updated_at = now()`,
    [
      scopedTenantId,
      externalSystem,
      profile.id,
      email,
      phone,
      matchedBy ?? null,
      confidence,
      ticketId,
      channel
    ]
  );
}
