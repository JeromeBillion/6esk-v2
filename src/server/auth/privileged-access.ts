import { db } from "@/server/db";
import { DEFAULT_WORKSPACE_KEY } from "@/server/workspace-modules";

export type PrivilegedAccessType = "support" | "break_glass";
export type PrivilegedAccessStatus = "pending" | "active" | "revoked" | "expired" | "denied";

export type PrivilegedAccessGrant = {
  id: string;
  tenant_id: string;
  workspace_key: string;
  access_type: PrivilegedAccessType;
  status: PrivilegedAccessStatus;
  subject_user_id: string | null;
  subject_email: string;
  subject_name: string | null;
  requested_by_user_id: string | null;
  approved_by_user_id: string | null;
  revoked_by_user_id: string | null;
  reason: string;
  reference: string | null;
  approval_note: string | null;
  revoke_reason: string | null;
  requested_duration_minutes: number;
  requested_at: string | Date;
  approved_at: string | Date | null;
  revoked_at: string | Date | null;
  expires_at: string | Date | null;
  created_at: string | Date;
  updated_at: string | Date;
  metadata: Record<string, unknown>;
};

export type PrivilegedAccessStats = {
  pending: number;
  active: number;
  activeBreakGlass: number;
  expired: number;
  revoked: number;
  needsPostEventReview: number;
};

type Scope = {
  tenantId: string;
  workspaceKey?: string | null;
};

type CreatePrivilegedAccessGrantInput = {
  accessType: PrivilegedAccessType;
  subjectUserId?: string | null;
  subjectEmail: string;
  subjectName?: string | null;
  reason: string;
  reference?: string | null;
  requestedDurationMinutes: number;
  metadata?: Record<string, unknown>;
};

type ActiveGrantForSubjectInput = {
  grantId: string;
  tenantId: string;
  workspaceKey?: string | null;
  subjectUserId?: string | null;
  subjectEmail: string;
  accessTypes?: PrivilegedAccessType[];
};

const MAX_SUPPORT_DURATION_MINUTES = 8 * 60;
const MAX_BREAK_GLASS_DURATION_MINUTES = 60;

const GRANT_COLUMNS = `id,
       tenant_id,
       workspace_key,
       access_type,
       status,
       subject_user_id,
       subject_email,
       subject_name,
       requested_by_user_id,
       approved_by_user_id,
       revoked_by_user_id,
       reason,
       reference,
       approval_note,
       revoke_reason,
       requested_duration_minutes,
       requested_at,
       approved_at,
       revoked_at,
       expires_at,
       created_at,
       updated_at,
       metadata`;

function workspaceKeyFor(scope: Pick<Scope, "workspaceKey">) {
  return scope.workspaceKey?.trim() || DEFAULT_WORKSPACE_KEY;
}

function normalizeEmail(value: string) {
  const email = value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("A valid subject email is required.");
  }
  return email;
}

function cleanText(value: string | null | undefined, maxLength: number) {
  const normalized = value?.trim() ?? "";
  return normalized ? normalized.slice(0, maxLength) : null;
}

function requiredText(value: string, fieldName: string, minLength: number, maxLength: number) {
  const normalized = value.trim();
  if (normalized.length < minLength) {
    throw new Error(`${fieldName} must be at least ${minLength} characters.`);
  }
  return normalized.slice(0, maxLength);
}

function normalizeMetadata(value: Record<string, unknown> | undefined) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value;
}

export function maxPrivilegedAccessDurationMinutes(accessType: PrivilegedAccessType) {
  return accessType === "break_glass" ? MAX_BREAK_GLASS_DURATION_MINUTES : MAX_SUPPORT_DURATION_MINUTES;
}

function normalizeDuration(accessType: PrivilegedAccessType, value: number) {
  const numeric = Math.trunc(Number(value));
  const max = maxPrivilegedAccessDurationMinutes(accessType);
  if (!Number.isFinite(numeric) || numeric < 5) {
    throw new Error("Requested access duration must be at least 5 minutes.");
  }
  return Math.min(numeric, max);
}

function numberFromCount(value: string | number | undefined) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function hasPrivilegedMfaSession(user: { session_auth_provider?: string | null } | null) {
  const provider = user?.session_auth_provider?.trim().toLowerCase() ?? "";
  return provider === "password_mfa" || provider.endsWith("_mfa");
}

export async function expirePrivilegedAccessGrants(scope: Scope) {
  await db.query(
    `UPDATE privileged_access_grants
     SET status = 'expired',
         updated_at = now()
     WHERE tenant_id = $1
       AND workspace_key = $2
       AND status = 'active'
       AND expires_at <= now()`,
    [scope.tenantId, workspaceKeyFor(scope)]
  );
}

export async function listPrivilegedAccessGrants(scope: Scope, limit = 25) {
  await expirePrivilegedAccessGrants(scope);
  const cappedLimit = Math.min(Math.max(Math.trunc(limit), 1), 100);
  const result = await db.query<PrivilegedAccessGrant>(
    `SELECT ${GRANT_COLUMNS}
     FROM privileged_access_grants
     WHERE tenant_id = $1
       AND workspace_key = $2
     ORDER BY
       CASE status
         WHEN 'pending' THEN 0
         WHEN 'active' THEN 1
         WHEN 'expired' THEN 2
         WHEN 'revoked' THEN 3
         ELSE 4
       END,
       created_at DESC
     LIMIT $3`,
    [scope.tenantId, workspaceKeyFor(scope), cappedLimit]
  );
  return result.rows;
}

export async function getPrivilegedAccessStats(scope: Scope): Promise<PrivilegedAccessStats> {
  await expirePrivilegedAccessGrants(scope);
  const result = await db.query<{
    pending: number;
    active: number;
    active_break_glass: number;
    expired: number;
    revoked: number;
    needs_post_event_review: number;
  }>(
    `SELECT
       COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
       COUNT(*) FILTER (WHERE status = 'active')::int AS active,
       COUNT(*) FILTER (WHERE status = 'active' AND access_type = 'break_glass')::int AS active_break_glass,
       COUNT(*) FILTER (WHERE status = 'expired')::int AS expired,
       COUNT(*) FILTER (WHERE status = 'revoked')::int AS revoked,
       COUNT(*) FILTER (
         WHERE status IN ('expired', 'revoked')
           AND metadata->'postEventReview' IS NULL
       )::int AS needs_post_event_review
     FROM privileged_access_grants
     WHERE tenant_id = $1
       AND workspace_key = $2`,
    [scope.tenantId, workspaceKeyFor(scope)]
  );
  const row = result.rows[0];
  return {
    pending: numberFromCount(row?.pending),
    active: numberFromCount(row?.active),
    activeBreakGlass: numberFromCount(row?.active_break_glass),
    expired: numberFromCount(row?.expired),
    revoked: numberFromCount(row?.revoked),
    needsPostEventReview: numberFromCount(row?.needs_post_event_review)
  };
}

export async function getActivePrivilegedAccessGrantForSubject({
  grantId,
  tenantId,
  workspaceKey,
  subjectUserId,
  subjectEmail,
  accessTypes = ["support", "break_glass"]
}: ActiveGrantForSubjectInput) {
  const normalizedEmail = normalizeEmail(subjectEmail);
  const allowedTypes = accessTypes.length > 0 ? accessTypes : ["support", "break_glass"];
  const result = await db.query<PrivilegedAccessGrant>(
    `SELECT ${GRANT_COLUMNS}
     FROM privileged_access_grants
     WHERE id = $1
       AND tenant_id = $2
       AND workspace_key = $3
       AND status = 'active'
       AND expires_at > now()
       AND access_type = ANY($4::text[])
       AND (
         ($5::uuid IS NOT NULL AND subject_user_id = $5::uuid)
         OR lower(subject_email) = $6
       )
     LIMIT 1`,
    [grantId, tenantId, workspaceKeyFor({ workspaceKey }), allowedTypes, subjectUserId ?? null, normalizedEmail]
  );
  return result.rows[0] ?? null;
}

export async function createPrivilegedAccessGrant(
  scope: Scope,
  actorUserId: string | null,
  input: CreatePrivilegedAccessGrantInput
) {
  const accessType = input.accessType;
  const subjectEmail = normalizeEmail(input.subjectEmail);
  const subjectName = cleanText(input.subjectName, 120);
  const reason = requiredText(input.reason, "Reason", 12, 1000);
  const reference = cleanText(input.reference, 240);
  const duration = normalizeDuration(accessType, input.requestedDurationMinutes);
  const metadata = normalizeMetadata(input.metadata);

  const result = await db.query<PrivilegedAccessGrant>(
    `INSERT INTO privileged_access_grants (
       tenant_id,
       workspace_key,
       access_type,
       status,
       subject_user_id,
       subject_email,
       subject_name,
       requested_by_user_id,
       reason,
       reference,
       requested_duration_minutes,
       metadata
     )
     VALUES ($1, $2, $3, 'pending', $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING ${GRANT_COLUMNS}`,
    [
      scope.tenantId,
      workspaceKeyFor(scope),
      accessType,
      input.subjectUserId ?? null,
      subjectEmail,
      subjectName,
      actorUserId,
      reason,
      reference,
      duration,
      metadata
    ]
  );
  return result.rows[0];
}

export async function approvePrivilegedAccessGrant(
  scope: Scope,
  grantId: string,
  actorUserId: string,
  approvalNote?: string | null
) {
  const note = cleanText(approvalNote, 1000);
  const result = await db.query<PrivilegedAccessGrant>(
    `UPDATE privileged_access_grants
     SET status = 'active',
         approved_by_user_id = $4,
         approval_note = $5,
         approved_at = now(),
         expires_at = now() + (requested_duration_minutes * interval '1 minute'),
         updated_at = now()
     WHERE id = $1
       AND tenant_id = $2
       AND workspace_key = $3
       AND status = 'pending'
       AND (requested_by_user_id IS NULL OR requested_by_user_id <> $4)
     RETURNING ${GRANT_COLUMNS}`,
    [grantId, scope.tenantId, workspaceKeyFor(scope), actorUserId, note]
  );
  if (!result.rows[0]) {
    throw new Error("Pending privileged access grant was not found or cannot be self-approved.");
  }
  return result.rows[0];
}

export async function revokePrivilegedAccessGrant(
  scope: Scope,
  grantId: string,
  actorUserId: string,
  revokeReason: string
) {
  const reason = requiredText(revokeReason, "Revoke reason", 4, 1000);
  const result = await db.query<PrivilegedAccessGrant>(
    `UPDATE privileged_access_grants
     SET status = 'revoked',
         revoked_by_user_id = $4,
         revoke_reason = $5,
         revoked_at = now(),
         updated_at = now()
     WHERE id = $1
       AND tenant_id = $2
       AND workspace_key = $3
       AND status IN ('pending', 'active')
     RETURNING ${GRANT_COLUMNS}`,
    [grantId, scope.tenantId, workspaceKeyFor(scope), actorUserId, reason]
  );
  if (!result.rows[0]) {
    throw new Error("Active or pending privileged access grant was not found.");
  }
  return result.rows[0];
}

export async function reviewPrivilegedAccessGrant(
  scope: Scope,
  grantId: string,
  actorUserId: string,
  reviewNote: string
) {
  await expirePrivilegedAccessGrants(scope);
  const note = requiredText(reviewNote, "Review note", 8, 1000);
  const review = {
    reviewedByUserId: actorUserId,
    reviewedAt: new Date().toISOString(),
    reviewNote: note
  };
  const result = await db.query<PrivilegedAccessGrant>(
    `UPDATE privileged_access_grants
     SET metadata = jsonb_set(
           COALESCE(metadata, '{}'::jsonb),
           '{postEventReview}',
           $4::jsonb,
           true
         ),
         updated_at = now()
     WHERE id = $1
       AND tenant_id = $2
       AND workspace_key = $3
       AND status IN ('expired', 'revoked')
     RETURNING ${GRANT_COLUMNS}`,
    [grantId, scope.tenantId, workspaceKeyFor(scope), JSON.stringify(review)]
  );
  if (!result.rows[0]) {
    throw new Error("Expired or revoked privileged access grant was not found.");
  }
  return result.rows[0];
}
