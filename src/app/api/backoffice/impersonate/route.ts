import { z } from "zod";
import { db } from "@/server/db";
import { getSessionUser } from "@/server/auth/session";
import { isInternalStaff } from "@/server/auth/roles";
import {
  getActivePrivilegedAccessGrantForSubject,
  hasPrivilegedMfaSession
} from "@/server/auth/privileged-access";
import { recordAuditLog } from "@/server/audit";
import { cookies } from "next/headers";
import crypto from "crypto";

const impersonateSchema = z.object({
  tenantId: z.string().uuid(),
  grantId: z.string().uuid(),
  reason: z.string().trim().min(8).max(500),
  ticketRef: z.string().trim().min(3).max(128),
  durationMinutes: z.number().int().min(5).max(240).optional()
});

const DEFAULT_IMPERSONATION_MINUTES = 30;

function readDefaultImpersonationMinutes() {
  const configured = Number(process.env.IMPERSONATION_DEFAULT_MINUTES ?? DEFAULT_IMPERSONATION_MINUTES);
  if (!Number.isFinite(configured)) return DEFAULT_IMPERSONATION_MINUTES;
  return Math.min(240, Math.max(5, Math.trunc(configured)));
}

function hashToken(token: string) {
  const secret = process.env.SESSION_SECRET ?? "";
  return crypto.createHash("sha256").update(`${token}:${secret}`).digest("hex");
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!isInternalStaff(user)) {
    return Response.json({ error: "Forbidden. 6esk Staff only." }, { status: 403 });
  }
  if (!hasPrivilegedMfaSession(user)) {
    return Response.json({ error: "MFA is required for privileged access." }, { status: 403 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = impersonateSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json({ error: "Invalid payload", details: parsed.error.issues }, { status: 400 });
  }

  const targetTenantId = parsed.data.tenantId;
  const grantId = parsed.data.grantId;
  const reason = parsed.data.reason;
  const ticketRef = parsed.data.ticketRef;
  const durationMinutes = parsed.data.durationMinutes ?? readDefaultImpersonationMinutes();

  // Validate tenant exists
  const tenantResult = await db.query("SELECT id FROM tenants WHERE id = $1 LIMIT 1", [targetTenantId]);
  if (tenantResult.rows.length === 0) {
    return Response.json({ error: "Tenant not found" }, { status: 404 });
  }

  const grant = await getActivePrivilegedAccessGrantForSubject({
    grantId,
    tenantId: targetTenantId,
    subjectUserId: user!.id,
    subjectEmail: user!.email
  });
  if (!grant) {
    await recordAuditLog({
      tenantId: targetTenantId,
      actorUserId: user!.id,
      action: "support_impersonation_denied",
      entityType: "tenant",
      entityId: targetTenantId,
      data: {
        reason: "active_privileged_access_grant_required",
        grantId,
        ticketRef
      }
    });
    return Response.json({ error: "Active privileged access grant required." }, { status: 403 });
  }

  const grantExpiresAt = grant.expires_at ? new Date(grant.expires_at) : null;
  if (!grantExpiresAt || Number.isNaN(grantExpiresAt.getTime()) || grantExpiresAt.getTime() <= Date.now()) {
    return Response.json({ error: "Active privileged access grant required." }, { status: 403 });
  }
  const remainingGrantMinutes = Math.max(1, Math.floor((grantExpiresAt.getTime() - Date.now()) / 60_000));
  const effectiveDurationMinutes = Math.min(durationMinutes, remainingGrantMinutes);

  // Get current session token
  const cookieName = process.env.SESSION_COOKIE_NAME ?? "sixesk_session";
  const cookieStore = await cookies();
  const token = cookieStore.get(cookieName)?.value;

  if (!token) {
    return Response.json({ error: "No active session" }, { status: 401 });
  }

  const tokenHash = hashToken(token);

  await db.query(
    `UPDATE auth_sessions
     SET impersonated_tenant_id = $1,
         impersonation_reason = $2,
         impersonation_ticket_ref = $3,
         impersonation_started_at = now(),
         impersonation_expires_at = now() + make_interval(mins => $4::int),
         privileged_access_grant_id = $5
     WHERE token_hash = $6`,
    [targetTenantId, reason, ticketRef, effectiveDurationMinutes, grant.id, tokenHash]
  );

  // Critical: Audit log the break-glass action
  await recordAuditLog({
    tenantId: targetTenantId, // Log it in the target tenant's audit trail!
    actorUserId: user!.id,
    action: "support_impersonation_started",
    entityType: "tenant",
    entityId: targetTenantId,
    data: {
      reason,
      ticketRef,
      grantId: grant.id,
      accessType: grant.access_type,
      durationMinutes: effectiveDurationMinutes,
      expiresAtMinutesFromNow: effectiveDurationMinutes
    }
  });

  return Response.json({
    status: "impersonating",
    tenantId: targetTenantId,
    grantId: grant.id,
    durationMinutes: effectiveDurationMinutes
  });
}

export async function DELETE(request: Request) {
  const user = await getSessionUser();
  if (!user || !user.is_impersonating) {
    return Response.json({ status: "not_impersonating" });
  }

  const cookieName = process.env.SESSION_COOKIE_NAME ?? "sixesk_session";
  const cookieStore = await cookies();
  const token = cookieStore.get(cookieName)?.value;

  if (!token) {
    return Response.json({ error: "No active session" }, { status: 401 });
  }

  const tokenHash = hashToken(token);

  const previousTenantId = user.tenant_id;

  await db.query(
    `UPDATE auth_sessions
     SET impersonated_tenant_id = NULL,
         impersonation_reason = NULL,
         impersonation_ticket_ref = NULL,
         impersonation_started_at = NULL,
         impersonation_expires_at = NULL,
         privileged_access_grant_id = NULL
     WHERE token_hash = $1`,
    [tokenHash]
  );

  await recordAuditLog({
    tenantId: previousTenantId,
    actorUserId: user.id,
    action: "support_impersonation_ended",
    entityType: "tenant",
    entityId: previousTenantId,
    data: {}
  });

  return Response.json({ status: "impersonation_ended" });
}
