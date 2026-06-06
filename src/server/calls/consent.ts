import { db } from "@/server/db";
import { normalizeLinkEmail, normalizeLinkPhone } from "@/server/integrations/external-user-links";

export type VoiceConsentDecision = "granted" | "revoked";
export type VoiceConsentState = VoiceConsentDecision | "unknown";

export type VoiceConsentStateSnapshot = {
  state: VoiceConsentState;
  callbackPhone: string | null;
  termsVersion: string | null;
  source: string | null;
  updatedAt: string | null;
  identityType: "phone" | "email" | null;
  identityValue: string | null;
  customerId: string | null;
};

type VoiceConsentMetadataSnapshot = {
  state: VoiceConsentDecision;
  callbackPhone: string | null;
  termsVersion: string | null;
  source: string | null;
  occurredAt: Date | null;
  identityEmail: string | null;
  identityPhone: string | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function readString(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function readConsentDecision(value: unknown): VoiceConsentDecision | null {
  if (typeof value === "boolean") {
    return value ? "granted" : "revoked";
  }
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  if (["granted", "grant", "allow", "allowed", "true", "yes"].includes(normalized)) {
    return "granted";
  }
  if (["revoked", "revoke", "deny", "denied", "false", "no"].includes(normalized)) {
    return "revoked";
  }
  return null;
}

function parseDate(value: unknown) {
  const raw = readString(value);
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toIsoString(value: Date | string | null | undefined) {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function normalizeVoiceConsentPhone(value: string | null | undefined) {
  if (!value) return null;
  const normalized = normalizeLinkPhone(value);
  if (!normalized) return null;
  const digits = normalized.replace(/[^\d]/g, "");
  if (digits.length < 7 || digits.length > 15) {
    return null;
  }
  return normalized;
}

export function normalizeVoiceConsentEmail(value: string | null | undefined) {
  return normalizeLinkEmail(value);
}

function readNestedRecord(
  value: Record<string, unknown> | null,
  key: string
): Record<string, unknown> | null {
  if (!value) return null;
  return asRecord(value[key]);
}

function extractIdentityPhone(metadata: Record<string, unknown> | null) {
  if (!metadata) return null;
  const direct = [
    "voiceCallbackPhone",
    "voice_callback_phone",
    "callbackPhone",
    "callback_phone",
    "phone",
    "phoneNumber",
    "appUserPhone",
    "toPhone"
  ];
  for (const key of direct) {
    const normalized = normalizeVoiceConsentPhone(readString(metadata[key]));
    if (normalized) return normalized;
  }

  const voice = readNestedRecord(metadata, "voice");
  if (voice) {
    const voicePhone = normalizeVoiceConsentPhone(
      readString(voice.callbackPhone) ?? readString(voice.phone) ?? readString(voice.phoneNumber)
    );
    if (voicePhone) return voicePhone;
  }

  const externalProfile = readNestedRecord(metadata, "external_profile");
  if (externalProfile) {
    const profilePhone = normalizeVoiceConsentPhone(
      readString(externalProfile.callbackPhone) ??
        readString(externalProfile.phone) ??
        readString(externalProfile.phoneNumber)
    );
    if (profilePhone) return profilePhone;
  }

  return null;
}

function extractIdentityEmail(metadata: Record<string, unknown> | null) {
  if (!metadata) return null;
  const direct = ["email", "appUserEmail", "from", "fromEmail", "requesterEmail"];
  for (const key of direct) {
    const normalized = normalizeVoiceConsentEmail(readString(metadata[key]));
    if (normalized) return normalized;
  }

  const externalProfile = readNestedRecord(metadata, "external_profile");
  if (externalProfile) {
    const profileEmail = normalizeVoiceConsentEmail(
      readString(externalProfile.email) ?? readString(externalProfile.secondaryEmail)
    );
    if (profileEmail) return profileEmail;
  }

  return null;
}

export function extractVoiceConsentFromMetadata(
  metadata: Record<string, unknown> | null | undefined
): VoiceConsentMetadataSnapshot | null {
  const root = asRecord(metadata);
  if (!root) {
    return null;
  }

  const voice = readNestedRecord(root, "voice");
  const externalProfile = readNestedRecord(root, "external_profile");

  const state =
    readConsentDecision(root.voiceConsentState) ??
    readConsentDecision(root.voice_consent_state) ??
    readConsentDecision(root.callConsentState) ??
    readConsentDecision(root.call_consent_state) ??
    readConsentDecision(root.voiceConsent) ??
    readConsentDecision(root.voice_consent) ??
    readConsentDecision(root.callConsent) ??
    readConsentDecision(root.call_consent) ??
    readConsentDecision(voice?.consentState) ??
    readConsentDecision(voice?.consent_status) ??
    readConsentDecision(voice?.consent) ??
    readConsentDecision(voice?.consentGiven) ??
    readConsentDecision(externalProfile?.voiceConsentState) ??
    readConsentDecision(externalProfile?.voice_consent_state) ??
    readConsentDecision(externalProfile?.voiceConsent) ??
    readConsentDecision(externalProfile?.voice_consent) ??
    readConsentDecision(externalProfile?.callConsent);

  if (!state) {
    return null;
  }

  const termsVersion =
    readString(root.voiceTermsVersion) ??
    readString(root.voice_terms_version) ??
    readString(root.callTermsVersion) ??
    readString(root.call_terms_version) ??
    readString(root.termsVersion) ??
    readString(root.terms_version) ??
    readString(voice?.termsVersion) ??
    readString(voice?.terms_version) ??
    readString(externalProfile?.voiceTermsVersion) ??
    readString(externalProfile?.voice_terms_version);

  const source =
    readString(root.voiceConsentSource) ??
    readString(root.voice_consent_source) ??
    readString(root.callConsentSource) ??
    readString(root.call_consent_source) ??
    readString(voice?.source) ??
    readString(externalProfile?.voiceConsentSource) ??
    readString(externalProfile?.source);

  const occurredAt =
    parseDate(root.voiceConsentAt) ??
    parseDate(root.voice_consent_at) ??
    parseDate(root.callConsentAt) ??
    parseDate(root.call_consent_at) ??
    parseDate(root.voiceConsentTimestamp) ??
    parseDate(root.voice_consent_timestamp) ??
    parseDate(voice?.consentAt) ??
    parseDate(voice?.consentTimestamp) ??
    parseDate(externalProfile?.voiceConsentAt);

  return {
    state,
    callbackPhone: extractIdentityPhone(root),
    identityPhone: extractIdentityPhone(root),
    identityEmail: extractIdentityEmail(root),
    source: source ?? null,
    termsVersion: termsVersion ?? null,
    occurredAt
  };
}

export async function resolveExistingCustomerIdForVoiceConsent({
  email,
  phone
}: {
  email?: string | null;
  phone?: string | null;
}) {
  const normalizedEmail = normalizeVoiceConsentEmail(email);
  const normalizedPhone = normalizeVoiceConsentPhone(phone);
  if (!normalizedEmail && !normalizedPhone) {
    return null;
  }

  const byIdentity = await db.query<{ id: string }>(
    `SELECT c.id
     FROM customer_identities ci
     JOIN customers c ON c.id = ci.customer_id
     WHERE c.merged_into_customer_id IS NULL
       AND (
         ($1::text IS NOT NULL AND ci.identity_type = 'email' AND ci.identity_value = $1::text)
         OR ($2::text IS NOT NULL AND ci.identity_type = 'phone' AND ci.identity_value = $2::text)
       )
     ORDER BY CASE c.kind WHEN 'registered' THEN 0 ELSE 1 END, c.created_at ASC
     LIMIT 1`,
    [normalizedEmail, normalizedPhone]
  );
  if (byIdentity.rows[0]?.id) {
    return byIdentity.rows[0].id;
  }

  const byPrimary = await db.query<{ id: string }>(
    `SELECT c.id
     FROM customers c
     WHERE c.merged_into_customer_id IS NULL
       AND (
         ($1::text IS NOT NULL AND lower(c.primary_email) = $1::text)
         OR ($2::text IS NOT NULL AND c.primary_phone = $2::text)
       )
     ORDER BY CASE c.kind WHEN 'registered' THEN 0 ELSE 1 END, c.created_at ASC
     LIMIT 1`,
    [normalizedEmail, normalizedPhone]
  );
  return byPrimary.rows[0]?.id ?? null;
}

export async function recordVoiceConsentEvent({
  decision,
  customerId,
  phone,
  email,
  callbackPhone,
  termsVersion,
  source,
  occurredAt,
  metadata
}: {
  decision: VoiceConsentDecision;
  customerId?: string | null;
  phone?: string | null;
  email?: string | null;
  callbackPhone?: string | null;
  termsVersion?: string | null;
  source: string;
  occurredAt?: Date | null;
  metadata?: Record<string, unknown> | null;
}) {
  const normalizedPhone = normalizeVoiceConsentPhone(phone);
  const normalizedEmail = normalizeVoiceConsentEmail(email);
  const normalizedCallbackPhone = normalizeVoiceConsentPhone(callbackPhone) ?? normalizedPhone;

  const identityType = normalizedPhone ? "phone" : normalizedEmail ? "email" : null;
  const identityValue = normalizedPhone ?? normalizedEmail;
  if (!identityType || !identityValue) {
    throw new Error("At least one valid phone or email identity is required to record consent.");
  }

  const sourceValue = readString(source);
  if (!sourceValue) {
    throw new Error("Consent source is required.");
  }

  await db.query(
    `INSERT INTO voice_consent_events (
      customer_id,
      identity_type,
      identity_value,
      consent_state,
      callback_phone,
      terms_version,
      source,
      event_at,
      metadata
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9
    )`,
    [
      customerId ?? null,
      identityType,
      identityValue,
      decision,
      normalizedCallbackPhone ?? null,
      readString(termsVersion) ?? null,
      sourceValue,
      occurredAt ?? new Date(),
      metadata ?? {}
    ]
  );
}

export async function syncVoiceConsentFromMetadata({
  metadata,
  customerId,
  fallbackPhone,
  fallbackEmail,
  defaultSource,
  consentTermsVersion,
  context
}: {
  metadata: Record<string, unknown> | null | undefined;
  customerId?: string | null;
  fallbackPhone?: string | null;
  fallbackEmail?: string | null;
  defaultSource?: string | null;
  consentTermsVersion?: string | null;
  context?: Record<string, unknown> | null;
}) {
  const snapshot = extractVoiceConsentFromMetadata(metadata);
  if (!snapshot) {
    return false;
  }

  const phone = snapshot.identityPhone ?? normalizeVoiceConsentPhone(fallbackPhone);
  const email = snapshot.identityEmail ?? normalizeVoiceConsentEmail(fallbackEmail);
  if (!phone && !email) {
    return false;
  }

  await recordVoiceConsentEvent({
    decision: snapshot.state,
    customerId: customerId ?? null,
    phone,
    email,
    callbackPhone: snapshot.callbackPhone ?? phone,
    termsVersion: snapshot.termsVersion ?? readString(consentTermsVersion),
    source: snapshot.source ?? readString(defaultSource) ?? "ticket_metadata",
    occurredAt: snapshot.occurredAt,
    metadata: {
      ...(context ?? {}),
      source: "ticket_metadata_sync"
    }
  });

  return true;
}

export async function getLatestVoiceConsentState({
  customerId,
  phone,
  email
}: {
  customerId?: string | null;
  phone?: string | null;
  email?: string | null;
}): Promise<VoiceConsentStateSnapshot> {
  const normalizedPhone = normalizeVoiceConsentPhone(phone);
  const normalizedEmail = normalizeVoiceConsentEmail(email);

  const values: Array<string> = [];
  const conditions: string[] = [];

  if (customerId) {
    values.push(customerId);
    conditions.push(`customer_id = $${values.length}`);
  }

  if (normalizedPhone) {
    values.push(normalizedPhone);
    const phonePlaceholder = `$${values.length}`;
    conditions.push(`(identity_type = 'phone' AND identity_value = ${phonePlaceholder})`);
    conditions.push(`callback_phone = ${phonePlaceholder}`);
  }

  if (normalizedEmail) {
    values.push(normalizedEmail);
    conditions.push(`(identity_type = 'email' AND identity_value = $${values.length})`);
  }

  if (conditions.length === 0) {
    return {
      state: "unknown",
      callbackPhone: null,
      termsVersion: null,
      source: null,
      updatedAt: null,
      identityType: null,
      identityValue: null,
      customerId: customerId ?? null
    };
  }

  const result = await db.query<{
    customer_id: string | null;
    identity_type: "phone" | "email";
    identity_value: string;
    consent_state: VoiceConsentDecision;
    callback_phone: string | null;
    terms_version: string | null;
    source: string | null;
    event_at: Date | string | null;
  }>(
    `SELECT
       customer_id,
       identity_type,
       identity_value,
       consent_state,
       callback_phone,
       terms_version,
       source,
       event_at
     FROM voice_consent_events
     WHERE ${conditions.join(" OR ")}
     ORDER BY event_at DESC, created_at DESC
     LIMIT 1`,
    values
  );

  const row = result.rows[0];
  if (!row) {
    return {
      state: "unknown",
      callbackPhone: null,
      termsVersion: null,
      source: null,
      updatedAt: null,
      identityType: null,
      identityValue: null,
      customerId: customerId ?? null
    };
  }

  return {
    state: row.consent_state,
    callbackPhone: row.callback_phone ?? (row.identity_type === "phone" ? row.identity_value : null),
    termsVersion: readString(row.terms_version),
    source: readString(row.source),
    updatedAt: toIsoString(row.event_at),
    identityType: row.identity_type,
    identityValue: readString(row.identity_value),
    customerId: row.customer_id
  };
}
