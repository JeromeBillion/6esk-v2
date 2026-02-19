import { db } from "@/server/db";
import { isWithinWorkingHours } from "@/server/agents/policy";
import type { VoiceConsentStateSnapshot } from "@/server/calls/consent";

type VoiceWorkingHours = {
  timezone?: string;
  days?: number[];
  start?: string;
  end?: string;
};

type VoicePolicyShape = {
  enabled?: boolean;
  allowed_hours?: VoiceWorkingHours;
  require_human_confirmation_for_unknown_numbers?: boolean;
  max_calls_per_hour?: number;
  require_consent?: boolean;
};

type VoicePolicyBlockCode =
  | "voice_disabled"
  | "outside_allowed_hours"
  | "consent_required"
  | "selection_required"
  | "rate_limited";

type VoicePolicyEvaluation =
  | { allowed: true }
  | {
      allowed: false;
      code: VoicePolicyBlockCode;
      detail: string;
    };

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function readBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  return null;
}

function readNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function readWorkingHours(value: unknown): VoiceWorkingHours | null {
  const record = asRecord(value);
  if (!record) return null;
  return {
    timezone: typeof record.timezone === "string" ? record.timezone : undefined,
    days: Array.isArray(record.days)
      ? record.days
          .map((item) => Number(item))
          .filter((item) => Number.isFinite(item) && item >= 0 && item <= 6)
      : undefined,
    start: typeof record.start === "string" ? record.start : undefined,
    end: typeof record.end === "string" ? record.end : undefined
  };
}

function normalizeVoicePolicy(
  rawPolicy: Record<string, unknown> | null | undefined
): VoicePolicyShape {
  const root = asRecord(rawPolicy);
  const voice = asRecord(root?.voice) ?? root;
  if (!voice) {
    return {};
  }

  const enabled = readBoolean(voice.enabled);
  const requireConsent =
    readBoolean(voice.require_consent) ?? readBoolean(voice.consent_required);
  const requireHumanConfirmation =
    readBoolean(voice.require_human_confirmation_for_unknown_numbers) ??
    readBoolean(voice.requireHumanConfirmationForUnknownNumbers);
  const maxCallsPerHour =
    readNumber(voice.max_calls_per_hour) ?? readNumber(voice.maxCallsPerHour);

  return {
    enabled: enabled ?? undefined,
    allowed_hours: readWorkingHours(voice.allowed_hours) ?? undefined,
    require_human_confirmation_for_unknown_numbers: requireHumanConfirmation ?? undefined,
    max_calls_per_hour:
      typeof maxCallsPerHour === "number" && maxCallsPerHour > 0
        ? Math.floor(maxCallsPerHour)
        : undefined,
    require_consent: requireConsent ?? undefined
  };
}

function hasVoiceConsent(metadata: Record<string, unknown> | null | undefined) {
  const root = asRecord(metadata);
  if (!root) return false;

  const direct =
    readBoolean(root.voiceConsent) ??
    readBoolean(root.voice_consent) ??
    readBoolean(root.callConsent) ??
    readBoolean(root.call_consent);
  if (direct === true) return true;

  const voice = asRecord(root.voice);
  const voiceConsent =
    readBoolean(voice?.consent) ?? readBoolean(voice?.consentGiven) ?? readBoolean(voice?.allowed);
  if (voiceConsent === true) return true;

  const externalProfile = asRecord(root.external_profile);
  const externalConsent =
    readBoolean(externalProfile?.voiceConsent) ??
    readBoolean(externalProfile?.voice_consent) ??
    readBoolean(externalProfile?.callConsent);
  return externalConsent === true;
}

async function countRecentOutboundCalls({
  actor,
  actorUserId,
  actorIntegrationId
}: {
  actor: "human" | "ai";
  actorUserId?: string | null;
  actorIntegrationId?: string | null;
}) {
  if (actor === "human") {
    if (!actorUserId) return 0;
    const result = await db.query<{ count: number | string | null }>(
      `SELECT COUNT(*)::int AS count
       FROM call_sessions
       WHERE direction = 'outbound'
         AND created_by = 'human'
         AND created_by_user_id = $1
         AND queued_at >= now() - interval '1 hour'`,
      [actorUserId]
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  if (!actorIntegrationId) return 0;
  const result = await db.query<{ count: number | string | null }>(
    `SELECT COUNT(*)::int AS count
     FROM call_sessions
     WHERE direction = 'outbound'
       AND created_by = 'ai'
       AND created_by_integration_id = $1
       AND queued_at >= now() - interval '1 hour'`,
    [actorIntegrationId]
  );
  return Number(result.rows[0]?.count ?? 0);
}

export async function evaluateVoiceCallPolicy({
  actor,
  policy,
  ticketMetadata,
  consentState,
  selectedCandidateId,
  actorUserId,
  actorIntegrationId,
  defaultMaxCallsPerHour
}: {
  actor: "human" | "ai";
  policy?: Record<string, unknown> | null;
  ticketMetadata?: Record<string, unknown> | null;
  consentState?: VoiceConsentStateSnapshot | null;
  selectedCandidateId?: string | null;
  actorUserId?: string | null;
  actorIntegrationId?: string | null;
  defaultMaxCallsPerHour?: number | null;
}): Promise<VoicePolicyEvaluation> {
  const voicePolicy = normalizeVoicePolicy(policy ?? null);

  if (voicePolicy.enabled === false) {
    return {
      allowed: false,
      code: "voice_disabled",
      detail: "Voice calls are disabled by policy."
    };
  }

  if (voicePolicy.allowed_hours) {
    const inHours = isWithinWorkingHours({
      working_hours: {
        timezone: voicePolicy.allowed_hours.timezone,
        days: voicePolicy.allowed_hours.days,
        start: voicePolicy.allowed_hours.start,
        end: voicePolicy.allowed_hours.end
      }
    });
    if (!inHours) {
      return {
        allowed: false,
        code: "outside_allowed_hours",
        detail: "Voice calls are blocked outside allowed hours."
      };
    }
  }

  if (consentState?.state === "revoked") {
    return {
      allowed: false,
      code: "consent_required",
      detail: "Voice consent has been revoked. Ask the customer to opt in again before calling."
    };
  }

  const hasExplicitConsent = consentState?.state === "granted";
  if (voicePolicy.require_consent && !hasExplicitConsent && !hasVoiceConsent(ticketMetadata)) {
    return {
      allowed: false,
      code: "consent_required",
      detail: "Voice consent is required before placing this call."
    };
  }

  if (
    actor === "ai" &&
    voicePolicy.require_human_confirmation_for_unknown_numbers &&
    !selectedCandidateId
  ) {
    return {
      allowed: false,
      code: "selection_required",
      detail: "Policy requires explicit phone selection for unknown numbers."
    };
  }

  const fallbackLimit =
    typeof defaultMaxCallsPerHour === "number" && Number.isFinite(defaultMaxCallsPerHour)
      ? Math.max(0, Math.floor(defaultMaxCallsPerHour))
      : 0;
  const maxCallsPerHour = voicePolicy.max_calls_per_hour ?? (fallbackLimit > 0 ? fallbackLimit : null);
  if (maxCallsPerHour && maxCallsPerHour > 0) {
    const recentCount = await countRecentOutboundCalls({
      actor,
      actorUserId,
      actorIntegrationId
    });
    if (recentCount >= maxCallsPerHour) {
      return {
        allowed: false,
        code: "rate_limited",
        detail: `Voice call limit reached (${maxCallsPerHour} calls/hour).`
      };
    }
  }

  return { allowed: true };
}

function readCsvDays(value: string | null | undefined) {
  if (!value) return undefined;
  const parsed = value
    .split(",")
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isFinite(item) && item >= 0 && item <= 6);
  return parsed.length ? parsed : undefined;
}

export function getHumanVoicePolicyFromEnv() {
  const enabled = readBoolean(process.env.CALLS_ENABLED);
  const requireConsent = readBoolean(process.env.CALLS_REQUIRE_CONSENT);
  const start = process.env.CALLS_ALLOWED_HOURS_START?.trim() || "";
  const end = process.env.CALLS_ALLOWED_HOURS_END?.trim() || "";
  const timezone = process.env.CALLS_ALLOWED_HOURS_TIMEZONE?.trim() || "";
  const days = readCsvDays(process.env.CALLS_ALLOWED_HOURS_DAYS);
  const maxCallsPerHour = readNumber(process.env.CALLS_MAX_CALLS_PER_HOUR);

  const policy: Record<string, unknown> = {
    voice: {}
  };
  const voice = policy.voice as Record<string, unknown>;

  if (enabled !== null) {
    voice.enabled = enabled;
  }
  if (requireConsent !== null) {
    voice.require_consent = requireConsent;
  }
  if (typeof maxCallsPerHour === "number" && maxCallsPerHour > 0) {
    voice.max_calls_per_hour = Math.floor(maxCallsPerHour);
  }
  if (start && end) {
    voice.allowed_hours = {
      timezone: timezone || "UTC",
      days,
      start,
      end
    };
  }

  return policy;
}
