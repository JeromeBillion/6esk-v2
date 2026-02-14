type LookupPayloadUser = {
  id: string;
  email: string;
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

export type PredictionProfile = {
  id: string;
  email: string;
  secondaryEmail: string | null;
  fullName: string | null;
  phoneNumber: string | null;
  kycStatus: string | null;
  accountStatus: string | null;
};

export type PredictionProfileLookupResult =
  | { status: "disabled"; durationMs: number }
  | { status: "missed"; durationMs: number }
  | { status: "matched"; matchedBy: string | null; profile: PredictionProfile; durationMs: number }
  | { status: "error"; error: string; durationMs: number };

function parseBoolean(value: string | undefined, fallback: boolean) {
  if (!value) return fallback;
  return value === "true" || value === "1";
}

function parseInteger(value: string | undefined, fallback: number, min: number, max: number) {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.round(parsed), min), max);
}

function normalizeEmail(value: string | undefined) {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  return normalized || null;
}

function normalizePhone(value: string | undefined) {
  if (!value) return null;
  const normalized = value.replace(/[^\d+]/g, "").trim();
  return normalized || null;
}

function buildLookupUrl(baseUrl: string, email: string | null, phone: string | null) {
  const endpoint = baseUrl.endsWith("/api/v1/internal/support/users/lookup")
    ? new URL(baseUrl)
    : new URL("/api/v1/internal/support/users/lookup", baseUrl);

  if (email) {
    endpoint.searchParams.set("email", email);
  }
  if (phone) {
    endpoint.searchParams.set("phone", phone);
  }
  endpoint.searchParams.set("include_closed", "false");
  return endpoint.toString();
}

export function buildProfileMetadataPatch(
  lookup: PredictionProfileLookupResult
): Record<string, unknown> {
  const lookupAt = new Date().toISOString();
  if (lookup.status === "matched") {
    return {
      profile_lookup: {
        source: "prediction-market-mvp",
        status: "matched",
        lookupAt,
        matchedBy: lookup.matchedBy,
        durationMs: lookup.durationMs
      },
      external_profile: {
        source: "prediction-market-mvp",
        externalUserId: lookup.profile.id,
        matchedBy: lookup.matchedBy,
        matchedAt: lookupAt,
        fullName: lookup.profile.fullName,
        email: lookup.profile.email,
        secondaryEmail: lookup.profile.secondaryEmail,
        phoneNumber: lookup.profile.phoneNumber,
        kycStatus: lookup.profile.kycStatus,
        accountStatus: lookup.profile.accountStatus
      }
    };
  }

  if (lookup.status === "error") {
    return {
      profile_lookup: {
        source: "prediction-market-mvp",
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
        source: "prediction-market-mvp",
        status: "missed",
        lookupAt,
        durationMs: lookup.durationMs
      }
    };
  }

  return {
    profile_lookup: {
      source: "prediction-market-mvp",
      status: "disabled",
      lookupAt,
      durationMs: lookup.durationMs
    }
  };
}

export async function lookupPredictionProfile({
  email,
  phone
}: {
  email?: string;
  phone?: string;
}): Promise<PredictionProfileLookupResult> {
  const startedAt = Date.now();
  const elapsedMs = () => Math.max(0, Date.now() - startedAt);

  const enabled = parseBoolean(process.env.PREDICTION_PROFILE_LOOKUP_ENABLED, true);
  const baseUrl = process.env.PREDICTION_PROFILE_LOOKUP_URL ?? "";
  const sharedSecret = process.env.PREDICTION_PROFILE_LOOKUP_SECRET ?? "";

  if (!enabled || !baseUrl || !sharedSecret) {
    return { status: "disabled", durationMs: elapsedMs() };
  }

  const normalizedEmail = normalizeEmail(email);
  const normalizedPhone = normalizePhone(phone);
  if (!normalizedEmail && !normalizedPhone) {
    return { status: "missed", durationMs: elapsedMs() };
  }

  const timeoutMs = parseInteger(process.env.PREDICTION_PROFILE_LOOKUP_TIMEOUT_MS, 1500, 200, 10000);
  const retryCount = parseInteger(process.env.PREDICTION_PROFILE_LOOKUP_RETRY_COUNT, 1, 0, 3);
  const url = buildLookupUrl(baseUrl, normalizedEmail, normalizedPhone);

  let lastError = "Lookup failed";

  for (let attempt = 0; attempt <= retryCount; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort("timeout"), timeoutMs);
    try {
      const response = await fetch(url, {
        method: "GET",
        headers: {
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
        continue;
      }

      const payload = (await response.json()) as LookupPayload;
      if (!payload.matched || !payload.user) {
        return { status: "missed", durationMs: elapsedMs() };
      }

      return {
        status: "matched",
        matchedBy: payload.matchedBy ?? null,
        profile: {
          id: payload.user.id,
          email: payload.user.email,
          secondaryEmail: payload.user.secondary_email ?? null,
          fullName: payload.user.full_name ?? null,
          phoneNumber: payload.user.phone_number ?? null,
          kycStatus: payload.user.kyc_status ?? null,
          accountStatus: payload.user.account_status ?? null
        },
        durationMs: elapsedMs()
      };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        lastError = "timeout";
      } else {
        lastError = error instanceof Error ? error.message : "Lookup failed";
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  return {
    status: "error",
    error: lastError.slice(0, 200),
    durationMs: elapsedMs()
  };
}
