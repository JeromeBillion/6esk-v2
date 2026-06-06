import { db } from "@/server/db";
import { VIEWER_ROLE } from "@/server/auth/roles";
import { resolveTenantScope, type TenantScopeInput } from "@/server/tenant-context";

export const VOICE_OPERATOR_STATUSES = ["online", "away", "offline"] as const;

export type VoiceOperatorStatus = (typeof VOICE_OPERATOR_STATUSES)[number];

export type VoiceOperatorPresence = {
  userId: string;
  status: VoiceOperatorStatus;
  activeCallSessionId: string | null;
  ringingCallSessionId: string | null;
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
  ringingCallSessionId: string | null;
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

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function parseStatus(value: unknown): VoiceOperatorStatus | null {
  const normalized = readString(value)?.toLowerCase();
  if (!normalized) return null;
  if ((VOICE_OPERATOR_STATUSES as readonly string[]).includes(normalized)) {
    return normalized as VoiceOperatorStatus;
  }
  return null;
}

function readMetadataString(metadata: unknown, key: string) {
  return readString(asRecord(metadata)?.[key]);
}

function buildRoutingMetadataPatch(
  patch: Partial<{
    current_ringing_call_session_id: string | null;
    last_queue_offer_at: string | null;
    last_queue_connected_at: string | null;
    last_queue_passed_at: string | null;
    last_queue_missed_at: string | null;
    last_queue_outcome: string | null;
  }>
) {
  return Object.fromEntries(
    Object.entries(patch).map(([key, value]) => [key, value ?? null])
  );
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

export async function getVoiceOperatorPresence(
  userId: string,
  scopeInput?: TenantScopeInput
): Promise<VoiceOperatorPresence> {
  const scope = resolveTenantScope(scopeInput);
  const result = await db.query<{
    status: VoiceOperatorStatus | null;
    active_call_session_id: string | null;
    metadata: Record<string, unknown> | null;
    last_seen_at: Date | null;
    registered_at: Date | null;
  }>(
    `SELECT status, active_call_session_id, metadata, last_seen_at, registered_at
     FROM voice_operator_presence
     WHERE tenant_key = $1
       AND workspace_key = $2
       AND user_id = $3
     LIMIT 1`,
    [scope.tenantKey, scope.workspaceKey, userId]
  );

  const row = result.rows[0];
  return {
    userId,
    status: parseStatus(row?.status) ?? "offline",
    activeCallSessionId: row?.active_call_session_id ?? null,
    ringingCallSessionId: readMetadataString(row?.metadata, "current_ringing_call_session_id"),
    lastSeenAt: row?.last_seen_at?.toISOString() ?? null,
    registeredAt: row?.registered_at?.toISOString() ?? null
  };
}

export async function upsertVoiceOperatorPresence({
  tenantKey,
  workspaceKey,
  userId,
  status,
  activeCallSessionId,
  registered,
  metadata
}: {
  tenantKey?: string | null;
  workspaceKey?: string | null;
  userId: string;
  status: VoiceOperatorStatus;
  activeCallSessionId?: string | null;
  registered?: boolean;
  metadata?: Record<string, unknown> | null;
}) {
  const scope = resolveTenantScope({ tenantKey, workspaceKey });
  const result = await db.query<{
    status: VoiceOperatorStatus;
    active_call_session_id: string | null;
    metadata: Record<string, unknown> | null;
    last_seen_at: Date | null;
    registered_at: Date | null;
  }>(
    `INSERT INTO voice_operator_presence (
       tenant_key,
       workspace_key,
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
       $4,
       $5,
       CASE WHEN $6 THEN now() ELSE NULL END,
       now(),
       $7
     )
     ON CONFLICT (user_id) DO UPDATE
       SET status = EXCLUDED.status,
           active_call_session_id = EXCLUDED.active_call_session_id,
           registered_at = CASE
             WHEN $6 THEN now()
             ELSE voice_operator_presence.registered_at
           END,
           last_seen_at = now(),
           metadata = COALESCE(voice_operator_presence.metadata, '{}'::jsonb) || EXCLUDED.metadata,
           updated_at = now()
       WHERE voice_operator_presence.tenant_key = EXCLUDED.tenant_key
         AND voice_operator_presence.workspace_key = EXCLUDED.workspace_key
     RETURNING status, active_call_session_id, metadata, last_seen_at, registered_at`,
    [
      scope.tenantKey,
      scope.workspaceKey,
      userId,
      status,
      activeCallSessionId ?? null,
      registered === true,
      {
        ...(metadata ?? {}),
        ...(activeCallSessionId ? buildRoutingMetadataPatch({
          current_ringing_call_session_id: null,
          last_queue_connected_at: new Date().toISOString(),
          last_queue_outcome: "connected"
        }) : {}),
        ...(status === "offline"
          ? buildRoutingMetadataPatch({
              current_ringing_call_session_id: null
            })
          : {})
      }
    ]
  );

  const row = result.rows[0];
  if (!row) {
    return getVoiceOperatorPresence(userId, scope);
  }
  return {
    userId,
    status: parseStatus(row?.status) ?? status,
    activeCallSessionId: row?.active_call_session_id ?? null,
    ringingCallSessionId: readMetadataString(row?.metadata, "current_ringing_call_session_id"),
    lastSeenAt: row?.last_seen_at?.toISOString() ?? null,
    registeredAt: row?.registered_at?.toISOString() ?? null
  } satisfies VoiceOperatorPresence;
}

export async function listAvailableVoiceDeskOperators(
  limit = 8,
  scopeInput?: TenantScopeInput
): Promise<VoiceDeskOperator[]> {
  const scope = resolveTenantScope(scopeInput);
  const normalizedLimit = Math.min(Math.max(limit, 1), 25);
  const freshnessSeconds = getPresenceFreshnessSeconds();
  const result = await db.query<{
    user_id: string;
    email: string;
    display_name: string;
    role_name: string | null;
    status: VoiceOperatorStatus;
    active_call_session_id: string | null;
    ringing_call_session_id: string | null;
  }>(
    `SELECT
       u.id AS user_id,
       u.email,
       u.display_name,
       r.name AS role_name,
       presence.status,
       presence.active_call_session_id,
       presence.metadata->>'current_ringing_call_session_id' AS ringing_call_session_id
     FROM voice_operator_presence presence
     JOIN users u
       ON u.id = presence.user_id
      AND u.tenant_key = presence.tenant_key
      AND u.workspace_key = presence.workspace_key
     LEFT JOIN roles r ON r.id = u.role_id
     WHERE u.is_active = true
       AND u.tenant_key = $4
       AND u.workspace_key = $5
       AND COALESCE(r.name, '') <> $2
       AND presence.status = 'online'
       AND presence.active_call_session_id IS NULL
       AND presence.registered_at IS NOT NULL
       AND NULLIF(presence.metadata->>'current_ringing_call_session_id', '') IS NULL
       AND presence.last_seen_at >= now() - make_interval(secs => $1::int)
     ORDER BY
       COALESCE(NULLIF(presence.metadata->>'last_queue_offer_at', '')::timestamptz, to_timestamp(0)) ASC,
       COALESCE(NULLIF(presence.metadata->>'last_queue_connected_at', '')::timestamptz, to_timestamp(0)) ASC,
       presence.last_seen_at DESC,
       presence.updated_at ASC
     LIMIT $3`,
    [freshnessSeconds, VIEWER_ROLE, normalizedLimit, scope.tenantKey, scope.workspaceKey]
  );

  return result.rows.map((row) => ({
    userId: row.user_id,
      identity: buildDeskVoiceIdentity(row.user_id),
      displayName: row.display_name,
      email: row.email,
      status: row.status,
      activeCallSessionId: row.active_call_session_id,
      ringingCallSessionId: row.ringing_call_session_id
    }));
}

export async function listVoiceOperatorRoster(
  limit = 12,
  scopeInput?: TenantScopeInput
): Promise<VoiceDeskOperatorRosterEntry[]> {
  const scope = resolveTenantScope(scopeInput);
  const normalizedLimit = Math.min(Math.max(limit, 1), 25);
  const freshnessSeconds = getPresenceFreshnessSeconds();
  const result = await db.query<{
    user_id: string;
    email: string;
    display_name: string;
    status: VoiceOperatorStatus;
    active_call_session_id: string | null;
    ringing_call_session_id: string | null;
    last_seen_at: Date | null;
    registered_at: Date | null;
  }>(
    `SELECT
       u.id AS user_id,
       u.email,
       u.display_name,
       presence.status,
       presence.active_call_session_id,
       presence.metadata->>'current_ringing_call_session_id' AS ringing_call_session_id,
       presence.last_seen_at,
       presence.registered_at
     FROM voice_operator_presence presence
     JOIN users u
       ON u.id = presence.user_id
      AND u.tenant_key = presence.tenant_key
      AND u.workspace_key = presence.workspace_key
     LEFT JOIN roles r ON r.id = u.role_id
     WHERE u.is_active = true
       AND u.tenant_key = $4
       AND u.workspace_key = $5
       AND COALESCE(r.name, '') <> $2
       AND presence.last_seen_at >= now() - make_interval(secs => $1::int)
     ORDER BY
       CASE
         WHEN presence.status = 'online' AND NULLIF(presence.metadata->>'current_ringing_call_session_id', '') IS NOT NULL THEN 0
         WHEN presence.status = 'online' AND presence.active_call_session_id IS NULL THEN 0
         WHEN presence.status = 'online' AND presence.active_call_session_id IS NOT NULL THEN 1
         WHEN presence.status = 'away' THEN 2
         ELSE 3
       END,
       COALESCE(NULLIF(presence.metadata->>'last_queue_offer_at', '')::timestamptz, to_timestamp(0)) ASC,
       presence.updated_at ASC
     LIMIT $3`,
    [freshnessSeconds, VIEWER_ROLE, normalizedLimit, scope.tenantKey, scope.workspaceKey]
  );

  return result.rows.map((row) => ({
    userId: row.user_id,
    identity: buildDeskVoiceIdentity(row.user_id),
    displayName: row.display_name,
    email: row.email,
    status: row.status,
    activeCallSessionId: row.active_call_session_id,
    ringingCallSessionId: row.ringing_call_session_id,
    lastSeenAt: row.last_seen_at?.toISOString() ?? null,
    registeredAt: row.registered_at?.toISOString() ?? null
  }));
}

export async function resolveVoiceDeskTargetsForOutbound(
  actorUserId: string | null | undefined,
  scopeInput?: TenantScopeInput
) {
  const preferredUserId = readString(actorUserId);
  const available = await listAvailableVoiceDeskOperators(8, scopeInput);
  if (!preferredUserId) {
    return available;
  }

  const preferred = available.find((operator) => operator.userId === preferredUserId);
  if (preferred) {
    return [preferred];
  }

  return available;
}

export async function reserveNextVoiceDeskOperatorForCall({
  tenantKey,
  workspaceKey,
  callSessionId,
  excludeUserIds = []
}: {
  tenantKey?: string | null;
  workspaceKey?: string | null;
  callSessionId: string;
  excludeUserIds?: string[];
}): Promise<VoiceDeskOperator | null> {
  const scope = resolveTenantScope({ tenantKey, workspaceKey });
  const freshnessSeconds = getPresenceFreshnessSeconds();
  const exclusions = excludeUserIds.filter(Boolean);
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const candidateResult = await client.query<{
      user_id: string;
      email: string;
      display_name: string;
      status: VoiceOperatorStatus;
      active_call_session_id: string | null;
      ringing_call_session_id: string | null;
    }>(
      `SELECT
         u.id AS user_id,
         u.email,
         u.display_name,
         presence.status,
         presence.active_call_session_id,
         presence.metadata->>'current_ringing_call_session_id' AS ringing_call_session_id
       FROM voice_operator_presence presence
       JOIN users u
         ON u.id = presence.user_id
        AND u.tenant_key = presence.tenant_key
        AND u.workspace_key = presence.workspace_key
       LEFT JOIN roles r ON r.id = u.role_id
       WHERE u.is_active = true
         AND u.tenant_key = $4
         AND u.workspace_key = $5
         AND COALESCE(r.name, '') <> $2
         AND presence.status = 'online'
         AND presence.active_call_session_id IS NULL
         AND presence.registered_at IS NOT NULL
         AND NULLIF(presence.metadata->>'current_ringing_call_session_id', '') IS NULL
         AND presence.last_seen_at >= now() - make_interval(secs => $1::int)
         AND NOT (presence.user_id = ANY($3::uuid[]))
       ORDER BY
         COALESCE(NULLIF(presence.metadata->>'last_queue_offer_at', '')::timestamptz, to_timestamp(0)) ASC,
         COALESCE(NULLIF(presence.metadata->>'last_queue_connected_at', '')::timestamptz, to_timestamp(0)) ASC,
         presence.last_seen_at DESC,
         presence.updated_at ASC
       LIMIT 1
       FOR UPDATE SKIP LOCKED`,
      [freshnessSeconds, VIEWER_ROLE, exclusions, scope.tenantKey, scope.workspaceKey]
    );

    const candidate = candidateResult.rows[0];
    if (!candidate) {
      await client.query("ROLLBACK");
      return null;
    }

    await client.query(
      `UPDATE voice_operator_presence
       SET metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb,
           updated_at = now()
       WHERE user_id = $1
         AND tenant_key = $3
         AND workspace_key = $4`,
      [
        candidate.user_id,
        JSON.stringify(
          buildRoutingMetadataPatch({
            current_ringing_call_session_id: callSessionId,
            last_queue_offer_at: new Date().toISOString(),
            last_queue_outcome: "offered"
          })
        ),
        scope.tenantKey,
        scope.workspaceKey
      ]
    );

    await client.query("COMMIT");
    return {
      userId: candidate.user_id,
      identity: buildDeskVoiceIdentity(candidate.user_id),
      displayName: candidate.display_name,
      email: candidate.email,
      status: candidate.status,
      activeCallSessionId: candidate.active_call_session_id,
      ringingCallSessionId: callSessionId
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function markVoiceOperatorQueueOutcome({
  tenantKey,
  workspaceKey,
  userId,
  callSessionId,
  outcome
}: {
  tenantKey?: string | null;
  workspaceKey?: string | null;
  userId: string;
  callSessionId: string;
  outcome: "connected" | "passed" | "missed" | "cleared";
}) {
  const scope = resolveTenantScope({ tenantKey, workspaceKey });
  const timestamp = new Date().toISOString();
  const patch =
    outcome === "connected"
      ? buildRoutingMetadataPatch({
          current_ringing_call_session_id: null,
          last_queue_connected_at: timestamp,
          last_queue_outcome: "connected"
        })
      : outcome === "passed"
        ? buildRoutingMetadataPatch({
            current_ringing_call_session_id: null,
            last_queue_passed_at: timestamp,
            last_queue_outcome: "passed"
          })
        : outcome === "missed"
          ? buildRoutingMetadataPatch({
              current_ringing_call_session_id: null,
              last_queue_missed_at: timestamp,
              last_queue_outcome: "missed"
            })
          : buildRoutingMetadataPatch({
              current_ringing_call_session_id: null,
              last_queue_outcome: "cleared"
            });

  await db.query(
    `UPDATE voice_operator_presence
     SET metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb,
         updated_at = now()
     WHERE user_id = $1
       AND tenant_key = $5
       AND workspace_key = $6
       AND (
         NULLIF(metadata->>'current_ringing_call_session_id', '') IS NULL
         OR metadata->>'current_ringing_call_session_id' = $3
         OR $4 = 'connected'
       )`,
    [userId, JSON.stringify(patch), callSessionId, outcome, scope.tenantKey, scope.workspaceKey]
  );
}
