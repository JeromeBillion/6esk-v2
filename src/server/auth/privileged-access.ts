import { db } from "@/server/db";
import { resolveTenantScope, type TenantScopeInput } from "@/server/tenant-context";

export type PrivilegedAccessType = "support" | "break_glass";
export type PrivilegedAccessStatus = "pending" | "active" | "revoked" | "expired" | "denied";

export type PrivilegedAccessGrant = {
  id: string;
  tenant_key: string;
  workspace_key: string;
  access_type: PrivilegedAccessType;
  status: PrivilegedAccessStatus;
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

type CreatePrivilegedAccessGrantInput = {
  accessType: PrivilegedAccessType;
  subjectEmail: string;
  subjectName?: string | null;
  reason: string;
  reference?: string | null;
  requestedDurationMinutes: number;
  metadata?: Record<string, unknown>;
};

type ActiveGrantForSubjectInput = {
  grantId: string;
  subjectEmail: string;
  accessTypes?: PrivilegedAccessType[];
};

const MAX_SUPPORT_DURATION_MINUTES = 8 * 60;
const MAX_BREAK_GLASS_DURATION_MINUTES = 60;

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

function normalizeMetadata(value: Record<string, unknown> | undefined) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value;
}

export async function expirePrivilegedAccessGrants(scopeInput: TenantScopeInput) {
  const scope = resolveTenantScope(scopeInput);
  await db.query(
    `UPDATE privileged_access_grants
     SET status = 'expired',
         updated_at = now()
     WHERE tenant_key = $1
       AND workspace_key = $2
       AND status = 'active'
       AND expires_at <= now()`,
    [scope.tenantKey, scope.workspaceKey]
  );
}

export async function listPrivilegedAccessGrants(scopeInput: TenantScopeInput, limit = 25) {
  const scope = resolveTenantScope(scopeInput);
  await expirePrivilegedAccessGrants(scope);
  const cappedLimit = Math.min(Math.max(Math.trunc(limit), 1), 100);
  const result = await db.query<PrivilegedAccessGrant>(
    `SELECT id,
            tenant_key,
            workspace_key,
            access_type,
            status,
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
            metadata
     FROM privileged_access_grants
     WHERE tenant_key = $1
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
    [scope.tenantKey, scope.workspaceKey, cappedLimit]
  );
  return result.rows;
}

export async function getPrivilegedAccessStats(scopeInput: TenantScopeInput) {
  const scope = resolveTenantScope(scopeInput);
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
     WHERE tenant_key = $1
       AND workspace_key = $2`,
    [scope.tenantKey, scope.workspaceKey]
  );
  const row = result.rows[0] ?? {
    pending: 0,
    active: 0,
    active_break_glass: 0,
    expired: 0,
    revoked: 0,
    needs_post_event_review: 0
  };
  return {
    pending: row.pending,
    active: row.active,
    activeBreakGlass: row.active_break_glass,
    expired: row.expired,
    revoked: row.revoked,
    needsPostEventReview: row.needs_post_event_review
  };
}

export async function getPrivilegedAccessGrant(scopeInput: TenantScopeInput, grantId: string) {
  const scope = resolveTenantScope(scopeInput);
  await expirePrivilegedAccessGrants(scope);
  const result = await db.query<PrivilegedAccessGrant>(
    `SELECT id,
            tenant_key,
            workspace_key,
            access_type,
            status,
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
            metadata
     FROM privileged_access_grants
     WHERE id = $1
       AND tenant_key = $2
       AND workspace_key = $3
     LIMIT 1`,
    [grantId, scope.tenantKey, scope.workspaceKey]
  );
  return result.rows[0] ?? null;
}

export async function getActivePrivilegedAccessGrantForSubject({
  grantId,
  subjectEmail,
  accessTypes = ["support", "break_glass"]
}: ActiveGrantForSubjectInput) {
  const normalizedEmail = normalizeEmail(subjectEmail);
  const allowedTypes = accessTypes.length > 0 ? accessTypes : ["support", "break_glass"];
  const result = await db.query<PrivilegedAccessGrant>(
    `SELECT id,
            tenant_key,
            workspace_key,
            access_type,
            status,
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
            metadata
     FROM privileged_access_grants
     WHERE id = $1
       AND lower(subject_email) = $2
       AND status = 'active'
       AND expires_at > now()
       AND access_type = ANY($3::text[])
     LIMIT 1`,
    [grantId, normalizedEmail, allowedTypes]
  );
  return result.rows[0] ?? null;
}

export async function createPrivilegedAccessGrant(
  scopeInput: TenantScopeInput,
  actorUserId: string | null,
  input: CreatePrivilegedAccessGrantInput
) {
  const scope = resolveTenantScope(scopeInput);
  const accessType = input.accessType;
  const subjectEmail = normalizeEmail(input.subjectEmail);
  const subjectName = cleanText(input.subjectName, 120);
  const reason = requiredText(input.reason, "Reason", 12, 1000);
  const reference = cleanText(input.reference, 240);
  const duration = normalizeDuration(accessType, input.requestedDurationMinutes);
  const metadata = normalizeMetadata(input.metadata);

  const result = await db.query<PrivilegedAccessGrant>(
    `INSERT INTO privileged_access_grants (
       tenant_key,
       workspace_key,
       access_type,
       status,
       subject_email,
       subject_name,
       requested_by_user_id,
       reason,
       reference,
       requested_duration_minutes,
       metadata
     )
     VALUES ($1, $2, $3, 'pending', $4, $5, $6, $7, $8, $9, $10)
     RETURNING id,
               tenant_key,
               workspace_key,
               access_type,
               status,
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
               metadata`,
    [
      scope.tenantKey,
      scope.workspaceKey,
      accessType,
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
  scopeInput: TenantScopeInput,
  grantId: string,
  actorUserId: string,
  approvalNote?: string | null
) {
  const scope = resolveTenantScope(scopeInput);
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
       AND tenant_key = $2
       AND workspace_key = $3
       AND status = 'pending'
     RETURNING id,
               tenant_key,
               workspace_key,
               access_type,
               status,
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
               metadata`,
    [grantId, scope.tenantKey, scope.workspaceKey, actorUserId, note]
  );
  if (!result.rows[0]) {
    throw new Error("Pending privileged access grant was not found.");
  }
  return result.rows[0];
}

export async function revokePrivilegedAccessGrant(
  scopeInput: TenantScopeInput,
  grantId: string,
  actorUserId: string,
  revokeReason: string
) {
  const scope = resolveTenantScope(scopeInput);
  const reason = requiredText(revokeReason, "Revoke reason", 4, 1000);
  const result = await db.query<PrivilegedAccessGrant>(
    `UPDATE privileged_access_grants
     SET status = 'revoked',
         revoked_by_user_id = $4,
         revoke_reason = $5,
         revoked_at = now(),
         updated_at = now()
     WHERE id = $1
       AND tenant_key = $2
       AND workspace_key = $3
       AND status IN ('pending', 'active')
     RETURNING id,
               tenant_key,
               workspace_key,
               access_type,
               status,
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
               metadata`,
    [grantId, scope.tenantKey, scope.workspaceKey, actorUserId, reason]
  );
  if (!result.rows[0]) {
    throw new Error("Active or pending privileged access grant was not found.");
  }
  return result.rows[0];
}

export async function reviewPrivilegedAccessGrant(
  scopeInput: TenantScopeInput,
  grantId: string,
  actorUserId: string,
  reviewNote: string
) {
  const scope = resolveTenantScope(scopeInput);
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
       AND tenant_key = $2
       AND workspace_key = $3
       AND status IN ('expired', 'revoked')
     RETURNING id,
               tenant_key,
               workspace_key,
               access_type,
               status,
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
               metadata`,
    [grantId, scope.tenantKey, scope.workspaceKey, JSON.stringify(review)]
  );
  if (!result.rows[0]) {
    throw new Error("Expired or revoked privileged access grant was not found.");
  }
  return result.rows[0];
}
