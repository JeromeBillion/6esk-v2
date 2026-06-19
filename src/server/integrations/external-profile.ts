import { findExternalUserLinkByIdentity } from "@/server/integrations/external-user-links";

type LookupPayloadUser = {
  id: string;
  email?: string | null;
  secondary_email?: string | null;
  full_name?: string | null;
  phone_number?: string | null;
  kyc_status?: string | null;
  account_status?: string | null;
};

type LookupPayload = {
  matched?: boolean;
  matchedBy?: string | null;
  user?: LookupPayloadUser | null;
};

export const DEFAULT_EXTERNAL_PROFILE_SYSTEM = "external-profile";
export const WHITE_LABEL_WEBCHAT_PROFILE_SOURCE = "white-label-webchat";

export type ExternalProfile = {
  id: string;
  email?: string | null;
  secondaryEmail?: string | null;
  fullName?: string | null;
  phoneNumber?: string | null;
  kycStatus?: string | null;
  accountStatus?: string | null;
};

type ExternalProfileLookupSource = string;

export type ExternalProfileLookupResult =
  | { status: "disabled"; durationMs: number }
  | { status: "missed"; durationMs: number }
  | {
      status: "matched";
      source: ExternalProfileLookupSource;
      externalSystem: string;
      matchedBy: string | null;
      profile: ExternalProfile;
      durationMs: number;
    }
  | { status: "error"; error: string; durationMs: number };

const DEFAULT_LOOKUP_PATH = "/api/v1/internal/support/users/lookup";

export function readExternalProfileString(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

export function normalizeExternalProfileSystem(
  value: unknown,
  fallback = DEFAULT_EXTERNAL_PROFILE_SYSTEM
) {
  const raw = readExternalProfileString(value);
  if (!raw) return fallback;
  const normalized = raw
    .toLowerCase()
    .replace(/[^a-z0-9._:-]/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80);
  return normalized || fallback;
}

export function getExternalProfileSystem() {
  return normalizeExternalProfileSystem(process.env.EXTERNAL_PROFILE_SYSTEM);
}

function getLiveLookupSource() {
  return getExternalProfileSystem();
}

function getCacheLookupSource() {
  return `${getExternalProfileSystem()}-cache`;
}

function readObject(value: unknown) {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function parseBoolean(value: string | undefined, fallback: boolean) {
  if (!value) return fallback;
  return value === "true" || value === "1";
}

function parseInteger(value: string | undefined, fallback: number, min: number, max: number) {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.round(parsed), min), max);
}

function normalizeEmail(value: string | null | undefined) {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  return normalized || null;
}

function normalizePhone(value: string | null | undefined) {
  if (!value) return null;
  const normalized = value.replace(/[^\d+]/g, "").trim();
  return normalized || null;
}

function isTimeoutError(value: string | null | undefined) {
  if (!value) return false;
  return value.toLowerCase().includes("timeout");
}

function requireLookupTenantId(tenantId: string | null | undefined) {
  const scopedTenantId = tenantId?.trim();
  if (!scopedTenantId) {
    throw new Error("tenantId is required for external profile lookup");
  }
  return scopedTenantId;
}

function inferCacheMatchedBy({
  normalizedEmail,
  normalizedPhone,
  cachedEmail,
  cachedPhone,
  cachedMatchedBy
}: {
  normalizedEmail: string | null;
  normalizedPhone: string | null;
  cachedEmail: string | null;
  cachedPhone: string | null;
  cachedMatchedBy: string | null;
}) {
  if (cachedMatchedBy) {
    return cachedMatchedBy;
  }
  if (normalizedEmail && cachedEmail && normalizedEmail === cachedEmail) {
    return "email";
  }
  if (normalizedPhone && cachedPhone && normalizedPhone === cachedPhone) {
    return "phone";
  }
  return null;
}

export function enrichExternalProfileMetadata(metadata: Record<string, unknown> | null) {
  if (!metadata) return null;

  const existingProfile = readObject(metadata.external_profile);
  if (existingProfile) {
    if (readObject(metadata.profile_lookup)) {
      return metadata;
    }
    const matchedAt =
      readExternalProfileString(existingProfile.matchedAt) ?? new Date().toISOString();
    const source = normalizeExternalProfileSystem(existingProfile.source);
    return {
      ...metadata,
      profile_lookup: {
        source,
        status: "matched",
        matchedBy: readExternalProfileString(existingProfile.matchedBy),
        lookupAt: matchedAt
      }
    } as Record<string, unknown>;
  }

  const email = readExternalProfileString(metadata.appUserEmail);
  const isAuthenticated = metadata.isAuthenticated === true;
  if (!isAuthenticated || !email) {
    return metadata;
  }

  const matchedAt = new Date().toISOString();
  const source = WHITE_LABEL_WEBCHAT_PROFILE_SOURCE;
  return {
    ...metadata,
    external_profile: {
      source,
      externalUserId: readExternalProfileString(metadata.appUserId),
      matchedBy: "session_auth",
      matchedAt,
      fullName: readExternalProfileString(metadata.appUserFullName),
      email,
      secondaryEmail: readExternalProfileString(metadata.appUserSecondaryEmail),
      phoneNumber: readExternalProfileString(metadata.appUserPhone),
      kycStatus: readExternalProfileString(metadata.appUserKycStatus),
      accountStatus: readExternalProfileString(metadata.appUserAccountStatus)
    },
    profile_lookup: {
      source,
      status: "matched",
      matchedBy: "session_auth",
      lookupAt: matchedAt
    }
  } as Record<string, unknown>;
}

export function readExternalProfileFromMetadata(
  metadata: Record<string, unknown> | null
): ExternalProfile | null {
  const payload = readObject(metadata?.external_profile);
  if (!payload) return null;

  const id = readExternalProfileString(payload.externalUserId) ?? readExternalProfileString(payload.id);
  const email = readExternalProfileString(payload.email);
  const phoneNumber =
    readExternalProfileString(payload.phoneNumber) ?? readExternalProfileString(payload.phone);
  if (!id || (!email && !phoneNumber)) {
    return null;
  }

  return {
    id,
    email,
    secondaryEmail: readExternalProfileString(payload.secondaryEmail),
    fullName: readExternalProfileString(payload.fullName),
    phoneNumber,
    kycStatus: readExternalProfileString(payload.kycStatus),
    accountStatus: readExternalProfileString(payload.accountStatus)
  };
}

export function readExternalProfileSource(
  metadata: Record<string, unknown> | null,
  fallback = DEFAULT_EXTERNAL_PROFILE_SYSTEM
) {
  const profile = readObject(metadata?.external_profile);
  const lookup = readObject(metadata?.profile_lookup);
  return normalizeExternalProfileSystem(profile?.source ?? lookup?.externalSystem ?? lookup?.source, fallback);
}

export function readExternalProfileMatchedBy(metadata: Record<string, unknown> | null) {
  const profile = readObject(metadata?.external_profile);
  const lookup = readObject(metadata?.profile_lookup);
  return (
    readExternalProfileString(lookup?.matchedBy) ??
    readExternalProfileString(profile?.matchedBy) ??
    null
  );
}

async function lookupProfileFromCache({
  tenantId,
  normalizedEmail,
  normalizedPhone,
  elapsedMs
}: {
  tenantId: string;
  normalizedEmail: string | null;
  normalizedPhone: string | null;
  elapsedMs: () => number;
}): Promise<ExternalProfileLookupResult | null> {
  try {
    const externalSystem = getExternalProfileSystem();
    const cached = await findExternalUserLinkByIdentity({
      tenantId,
      externalSystem,
      email: normalizedEmail,
      phone: normalizedPhone
    });
    if (!cached) {
      return null;
    }

    const cachedEmail = normalizeEmail(cached.email ?? undefined);
    const cachedPhone = normalizePhone(cached.phone ?? undefined);
    const resolvedEmail = cachedEmail ?? normalizedEmail;
    const resolvedPhone = cachedPhone ?? normalizedPhone;
    if (!resolvedEmail && !resolvedPhone) {
      return null;
    }

    return {
      status: "matched",
      source: getCacheLookupSource(),
      externalSystem,
      matchedBy: inferCacheMatchedBy({
        normalizedEmail,
        normalizedPhone,
        cachedEmail,
        cachedPhone,
        cachedMatchedBy: cached.matched_by
      }),
      profile: {
        id: cached.external_user_id,
        email: resolvedEmail,
        secondaryEmail: null,
        fullName: null,
        phoneNumber: resolvedPhone,
        kycStatus: null,
        accountStatus: null
      },
      durationMs: elapsedMs()
    };
  } catch (error) {
    console.error("[ExternalProfile] Cache lookup failed:", error instanceof Error ? error.message : error);
    return null;
  }
}

function buildLookupUrl(baseUrl: string, email: string | null, phone: string | null) {
  const lookupPath = process.env.EXTERNAL_PROFILE_LOOKUP_PATH || DEFAULT_LOOKUP_PATH;
  const endpoint = baseUrl.endsWith(lookupPath) ? new URL(baseUrl) : new URL(lookupPath, baseUrl);

  if (email) {
    endpoint.searchParams.set("email", email);
  }
  if (phone) {
    endpoint.searchParams.set("phone", phone);
  }
  endpoint.searchParams.set("include_closed", "false");
  return endpoint.toString();
}

export function buildExternalProfileMetadataPatch(
  lookup: ExternalProfileLookupResult
): Record<string, unknown> {
  const lookupAt = new Date().toISOString();
  if (lookup.status === "matched") {
    return {
      profile_lookup: {
        source: lookup.source,
        externalSystem: lookup.externalSystem,
        status: "matched",
        lookupAt,
        matchedBy: lookup.matchedBy,
        durationMs: lookup.durationMs
      },
      external_profile: {
        source: lookup.externalSystem,
        externalUserId: lookup.profile.id,
        matchedBy: lookup.matchedBy,
        matchedAt: lookupAt,
        fullName: lookup.profile.fullName ?? null,
        email: lookup.profile.email ?? null,
        secondaryEmail: lookup.profile.secondaryEmail ?? null,
        phoneNumber: lookup.profile.phoneNumber ?? null,
        kycStatus: lookup.profile.kycStatus ?? null,
        accountStatus: lookup.profile.accountStatus ?? null
      }
    };
  }

  if (lookup.status === "error") {
    return {
      profile_lookup: {
        source: getLiveLookupSource(),
        externalSystem: getExternalProfileSystem(),
        status: "error",
        lookupAt,
        error: lookup.error,
        durationMs: lookup.durationMs
      }
    };
  }

  if (lookup.status === "missed") {
    return {
      profile_lookup: {
        source: getLiveLookupSource(),
        externalSystem: getExternalProfileSystem(),
        status: "missed",
        lookupAt,
        durationMs: lookup.durationMs
      }
    };
  }

  return {
    profile_lookup: {
      source: getLiveLookupSource(),
      externalSystem: getExternalProfileSystem(),
      status: "disabled",
      lookupAt,
      durationMs: lookup.durationMs
    }
  };
}

export async function lookupExternalProfile({
  tenantId,
  email,
  phone
}: {
  tenantId: string;
  email?: string;
  phone?: string;
}): Promise<ExternalProfileLookupResult> {
  const startedAt = Date.now();
  const elapsedMs = () => Math.max(0, Date.now() - startedAt);
  const scopedTenantId = requireLookupTenantId(tenantId);

  const enabled = parseBoolean(process.env.EXTERNAL_PROFILE_LOOKUP_ENABLED, true);
  const baseUrl = process.env.EXTERNAL_PROFILE_LOOKUP_URL ?? "";
  const sharedSecret = process.env.EXTERNAL_PROFILE_LOOKUP_SECRET ?? "";

  if (!enabled || !baseUrl || !sharedSecret) {
    return { status: "disabled", durationMs: elapsedMs() };
  }

  const normalizedEmail = normalizeEmail(email);
  const normalizedPhone = normalizePhone(phone);
  if (!normalizedEmail && !normalizedPhone) {
    return { status: "missed", durationMs: elapsedMs() };
  }

  const timeoutMs = parseInteger(process.env.EXTERNAL_PROFILE_LOOKUP_TIMEOUT_MS, 1500, 200, 10000);
  const retryCount = parseInteger(process.env.EXTERNAL_PROFILE_LOOKUP_RETRY_COUNT, 1, 0, 3);
  const url = buildLookupUrl(baseUrl, normalizedEmail, normalizedPhone);
  const externalSystem = getExternalProfileSystem();

  let lastError = "Lookup failed";
  let sawTimeoutError = false;

  for (let attempt = 0; attempt <= retryCount; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort("timeout"), timeoutMs);
    try {
      const response = await fetch(url, {
        method: "GET",
        headers: {
          "x-6esk-tenant-id": scopedTenantId,
          "x-6esk-secret": sharedSecret
        },
        signal: controller.signal
      });

      if (response.status === 404) {
        return { status: "disabled", durationMs: elapsedMs() };
      }

      if (!response.ok) {
        const details = await response.text().catch(() => "");
        lastError = details || `Lookup failed (${response.status})`;
        if (isTimeoutError(lastError)) {
          sawTimeoutError = true;
        }
        continue;
      }

      const payload = (await response.json()) as LookupPayload;
      if (!payload.matched || !payload.user) {
        const cachedMatch = await lookupProfileFromCache({
          tenantId: scopedTenantId,
          normalizedEmail,
          normalizedPhone,
          elapsedMs
        });
        return cachedMatch ?? { status: "missed", durationMs: elapsedMs() };
      }

      const profileEmail = normalizeEmail(payload.user.email ?? null);
      const profilePhone = normalizePhone(payload.user.phone_number ?? null);
      if (!payload.user.id || (!profileEmail && !profilePhone)) {
        return { status: "missed", durationMs: elapsedMs() };
      }

      return {
        status: "matched",
        source: getLiveLookupSource(),
        externalSystem,
        matchedBy: payload.matchedBy ?? null,
        profile: {
          id: payload.user.id,
          email: profileEmail,
          secondaryEmail: payload.user.secondary_email ?? null,
          fullName: payload.user.full_name ?? null,
          phoneNumber: profilePhone,
          kycStatus: payload.user.kyc_status ?? null,
          accountStatus: payload.user.account_status ?? null
        },
        durationMs: elapsedMs()
      };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        lastError = "timeout";
        sawTimeoutError = true;
      } else {
        lastError = error instanceof Error ? error.message : "Lookup failed";
        if (isTimeoutError(lastError)) {
          sawTimeoutError = true;
        }
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  if (sawTimeoutError) {
    const cachedMatch = await lookupProfileFromCache({
      tenantId: scopedTenantId,
      normalizedEmail,
      normalizedPhone,
      elapsedMs
    });
    if (cachedMatch) {
      return cachedMatch;
    }
  }

  return {
    status: "error",
    error: lastError.slice(0, 200),
    durationMs: elapsedMs()
  };
}
