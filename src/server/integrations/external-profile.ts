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

export function readExternalProfileString(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function normalizeExternalSystem(value: unknown, fallback = DEFAULT_EXTERNAL_PROFILE_SYSTEM) {
  const raw = readExternalProfileString(value);
  if (!raw) return fallback;
  const normalized = raw
    .toLowerCase()
    .replace(/[^a-z0-9._:-]/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80);
  return normalized || fallback;
}

function readObject(value: unknown) {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

export function enrichExternalProfileMetadata(metadata: Record<string, unknown> | null) {
  if (!metadata) return null;

  const existingProfile = readObject(metadata.external_profile);
  if (existingProfile) {
    if (readObject(metadata.profile_lookup)) {
      return metadata;
    }
    const matchedAt = readExternalProfileString(existingProfile.matchedAt) ?? new Date().toISOString();
    return {
      ...metadata,
      profile_lookup: {
        source: normalizeExternalSystem(existingProfile.source),
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
  return normalizeExternalSystem(profile?.source ?? lookup?.source, fallback);
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

export function buildExternalProfileMetadataPatch({
  profile,
  source,
  matchedBy,
  matchedAt = new Date().toISOString()
}: {
  profile: ExternalProfile;
  source?: string | null;
  matchedBy?: string | null;
  matchedAt?: string;
}): Record<string, unknown> {
  const normalizedSource = normalizeExternalSystem(source);
  return {
    profile_lookup: {
      source: normalizedSource,
      status: "matched",
      matchedBy: matchedBy ?? null,
      lookupAt: matchedAt
    },
    external_profile: {
      source: normalizedSource,
      externalUserId: profile.id,
      matchedBy: matchedBy ?? null,
      matchedAt,
      fullName: profile.fullName ?? null,
      email: profile.email ?? null,
      secondaryEmail: profile.secondaryEmail ?? null,
      phoneNumber: profile.phoneNumber ?? null,
      kycStatus: profile.kycStatus ?? null,
      accountStatus: profile.accountStatus ?? null
    }
  };
}
