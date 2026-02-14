import { db } from "@/server/db";
import type { PredictionProfile } from "@/server/integrations/prediction-profile";

type InboundChannel = "email" | "whatsapp";

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
  externalSystem,
  email,
  phone
}: {
  externalSystem: string;
  email?: string | null;
  phone?: string | null;
}) {
  const normalizedEmail = normalizeLinkEmail(email);
  const normalizedPhone = normalizeLinkPhone(phone);

  if (!normalizedEmail && !normalizedPhone) {
    return null;
  }

  const result = await db.query<ExternalUserLinkMatch>(
    `SELECT
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
     WHERE external_system = $1
       AND (
         ($2::text IS NOT NULL AND LOWER(email) = $2::text)
         OR ($3::text IS NOT NULL AND phone = $3::text)
       )
     ORDER BY
       CASE
         WHEN $2::text IS NOT NULL
           AND LOWER(email) = $2::text
           AND $3::text IS NOT NULL
           AND phone = $3::text
           THEN 0
         WHEN $2::text IS NOT NULL AND LOWER(email) = $2::text
           THEN 1
         WHEN $3::text IS NOT NULL AND phone = $3::text
           THEN 2
         ELSE 3
       END ASC,
       confidence DESC NULLS LAST,
       last_seen_at DESC
     LIMIT 1`,
    [externalSystem, normalizedEmail, normalizedPhone]
  );

  return result.rows[0] ?? null;
}

export async function upsertExternalUserLink({
  externalSystem,
  profile,
  matchedBy,
  inboundEmail,
  inboundPhone,
  ticketId,
  channel
}: {
  externalSystem: string;
  profile: PredictionProfile;
  matchedBy?: string | null;
  inboundEmail?: string | null;
  inboundPhone?: string | null;
  ticketId: string;
  channel: InboundChannel;
}) {
  const email = normalizeLinkEmail(inboundEmail) ?? normalizeLinkEmail(profile.email);
  const phone = normalizeLinkPhone(inboundPhone) ?? normalizeLinkPhone(profile.phoneNumber);

  if (!email && !phone) {
    return;
  }

  const confidence = deriveMatchConfidence(matchedBy);

  await db.query(
    `INSERT INTO external_user_links (
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
      $1, $2, $3, $4, $5, $6, $7, $8, now(), now()
    )
    ON CONFLICT (external_system, external_user_id)
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
