import { db } from "@/server/db";
import { VIEWER_ROLE } from "@/server/auth/roles";

export const VOICE_OPERATOR_STATUSES = ["online", "away", "offline"] as const;

export type VoiceOperatorStatus = (typeof VOICE_OPERATOR_STATUSES)[number];

export type VoiceOperatorPresence = {
  userId: string;
  status: VoiceOperatorStatus;
  activeCallSessionId: string | null;
  lastSeenAt: string | null;
  registeredAt: string | null;
};

export type VoiceDeskOperator = {
  userId: string;
  identity: string;
  displayName: string;
  email: string;
  status: VoiceOperatorStatus;
  activeCallSessionId: string | null;
};

export type VoiceDeskOperatorRosterEntry = VoiceDeskOperator & {
  lastSeenAt: string | null;
  registeredAt: string | null;
};

function readString(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function parseStatus(value: unknown): VoiceOperatorStatus | null {
  const normalized = readString(value)?.toLowerCase();
  if (!normalized) return null;
  if ((VOICE_OPERATOR_STATUSES as readonly string[]).includes(normalized)) {
    return normalized as VoiceOperatorStatus;
  }
  return null;
}

export function buildDeskVoiceIdentity(userId: string) {
  return `desk_user_${userId.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}

function getPresenceFreshnessSeconds() {
  const parsed = Number(process.env.CALLS_OPERATOR_PRESENCE_TTL_SECONDS ?? "90");
  if (!Number.isFinite(parsed) || parsed < 15) {
    return 90;
  }
  return Math.floor(parsed);
}

export async function getVoiceOperatorPresence(userId: string): Promise<VoiceOperatorPresence> {
  const result = await db.query<{
    status: VoiceOperatorStatus | null;
    active_call_session_id: string | null;
    last_seen_at: Date | null;
    registered_at: Date | null;
  }>(
    `SELECT status, active_call_session_id, last_seen_at, registered_at
     FROM voice_operator_presence
     WHERE user_id = $1
     LIMIT 1`,
    [userId]
  );

  const row = result.rows[0];
  return {
    userId,
    status: parseStatus(row?.status) ?? "offline",
    activeCallSessionId: row?.active_call_session_id ?? null,
    lastSeenAt: row?.last_seen_at?.toISOString() ?? null,
    registeredAt: row?.registered_at?.toISOString() ?? null
  };
}

export async function upsertVoiceOperatorPresence({
  userId,
  status,
  activeCallSessionId,
  registered,
  metadata
}: {
  userId: string;
  status: VoiceOperatorStatus;
  activeCallSessionId?: string | null;
  registered?: boolean;
  metadata?: Record<string, unknown> | null;
}) {
  const result = await db.query<{
    status: VoiceOperatorStatus;
    active_call_session_id: string | null;
    last_seen_at: Date | null;
    registered_at: Date | null;
  }>(
    `INSERT INTO voice_operator_presence (
       user_id,
       status,
       active_call_session_id,
       registered_at,
       last_seen_at,
       metadata
     ) VALUES (
       $1,
       $2,
       $3,
       CASE WHEN $4 THEN now() ELSE NULL END,
       now(),
       $5
     )
     ON CONFLICT (user_id) DO UPDATE
       SET status = EXCLUDED.status,
           active_call_session_id = EXCLUDED.active_call_session_id,
           registered_at = CASE
             WHEN $4 THEN now()
             ELSE voice_operator_presence.registered_at
           END,
           last_seen_at = now(),
           metadata = COALESCE(voice_operator_presence.metadata, '{}'::jsonb) || EXCLUDED.metadata,
           updated_at = now()
     RETURNING status, active_call_session_id, last_seen_at, registered_at`,
    [userId, status, activeCallSessionId ?? null, registered === true, metadata ?? {}]
  );

  const row = result.rows[0];
  return {
    userId,
    status: parseStatus(row?.status) ?? status,
    activeCallSessionId: row?.active_call_session_id ?? null,
    lastSeenAt: row?.last_seen_at?.toISOString() ?? null,
    registeredAt: row?.registered_at?.toISOString() ?? null
  } satisfies VoiceOperatorPresence;
}

export async function listAvailableVoiceDeskOperators(limit = 8): Promise<VoiceDeskOperator[]> {
  const normalizedLimit = Math.min(Math.max(limit, 1), 25);
  const freshnessSeconds = getPresenceFreshnessSeconds();
  const result = await db.query<{
    user_id: string;
    email: string;
    display_name: string;
    role_name: string | null;
    status: VoiceOperatorStatus;
    active_call_session_id: string | null;
  }>(
    `SELECT
       u.id AS user_id,
       u.email,
       u.display_name,
       r.name AS role_name,
       presence.status,
       presence.active_call_session_id
     FROM voice_operator_presence presence
     JOIN users u ON u.id = presence.user_id
     LEFT JOIN roles r ON r.id = u.role_id
     WHERE u.is_active = true
       AND COALESCE(r.name, '') <> $2
       AND presence.status = 'online'
       AND presence.active_call_session_id IS NULL
       AND presence.last_seen_at >= now() - make_interval(secs => $1::int)
     ORDER BY
       CASE WHEN r.name = 'lead_admin' THEN 0 ELSE 1 END,
       presence.updated_at ASC
     LIMIT $3`,
    [freshnessSeconds, VIEWER_ROLE, normalizedLimit]
  );

  return result.rows.map((row) => ({
    userId: row.user_id,
    identity: buildDeskVoiceIdentity(row.user_id),
    displayName: row.display_name,
    email: row.email,
    status: row.status,
    activeCallSessionId: row.active_call_session_id
  }));
}

export async function listVoiceOperatorRoster(limit = 12): Promise<VoiceDeskOperatorRosterEntry[]> {
  const normalizedLimit = Math.min(Math.max(limit, 1), 25);
  const freshnessSeconds = getPresenceFreshnessSeconds();
  const result = await db.query<{
    user_id: string;
    email: string;
    display_name: string;
    status: VoiceOperatorStatus;
    active_call_session_id: string | null;
    last_seen_at: Date | null;
    registered_at: Date | null;
  }>(
    `SELECT
       u.id AS user_id,
       u.email,
       u.display_name,
       presence.status,
       presence.active_call_session_id,
       presence.last_seen_at,
       presence.registered_at
     FROM voice_operator_presence presence
     JOIN users u ON u.id = presence.user_id
     LEFT JOIN roles r ON r.id = u.role_id
     WHERE u.is_active = true
       AND COALESCE(r.name, '') <> $2
       AND presence.last_seen_at >= now() - make_interval(secs => $1::int)
     ORDER BY
       CASE
         WHEN presence.status = 'online' AND presence.active_call_session_id IS NULL THEN 0
         WHEN presence.status = 'online' AND presence.active_call_session_id IS NOT NULL THEN 1
         WHEN presence.status = 'away' THEN 2
         ELSE 3
       END,
       presence.updated_at ASC
     LIMIT $3`,
    [freshnessSeconds, VIEWER_ROLE, normalizedLimit]
  );

  return result.rows.map((row) => ({
    userId: row.user_id,
    identity: buildDeskVoiceIdentity(row.user_id),
    displayName: row.display_name,
    email: row.email,
    status: row.status,
    activeCallSessionId: row.active_call_session_id,
    lastSeenAt: row.last_seen_at?.toISOString() ?? null,
    registeredAt: row.registered_at?.toISOString() ?? null
  }));
}

export async function resolveVoiceDeskTargetsForOutbound(actorUserId: string | null | undefined) {
  const preferredUserId = readString(actorUserId);
  const available = await listAvailableVoiceDeskOperators(8);
  if (!preferredUserId) {
    return available;
  }

  const preferred = available.find((operator) => operator.userId === preferredUserId);
  if (preferred) {
    return [preferred];
  }

  return available;
}
