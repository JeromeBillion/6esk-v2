import { z } from "zod";
import { recordAuditLog } from "@/server/audit";
import { hasActiveMfaFactor } from "@/server/auth/mfa";
import {
  approvePrivilegedAccessGrant,
  createPrivilegedAccessGrant,
  getPrivilegedAccessGrant,
  getPrivilegedAccessStats,
  listPrivilegedAccessGrants,
  reviewPrivilegedAccessGrant,
  revokePrivilegedAccessGrant,
  type PrivilegedAccessGrant
} from "@/server/auth/privileged-access";
import {
  sendPrivilegedAccessAlert,
  type PrivilegedAccessAlertEvent,
  type PrivilegedAccessAlertOutcome
} from "@/server/auth/privileged-access-alerts";
import { isLeadAdmin } from "@/server/auth/roles";
import {
  assertSensitiveSessionMfa,
  sensitiveSessionErrorResponse
} from "@/server/auth/sensitive-session";
import { getSessionContext } from "@/server/auth/session";
import { tenantScopeFromUser, type TenantScope } from "@/server/tenant-context";

const createGrantSchema = z.object({
  accessType: z.enum(["support", "break_glass"]),
  subjectEmail: z.string().email(),
  subjectName: z.string().trim().max(120).nullable().optional(),
  reason: z.string().trim().min(12).max(1000),
  reference: z.string().trim().max(240).nullable().optional(),
  requestedDurationMinutes: z.number().int().min(5).max(480)
});

const updateGrantSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("approve"),
    grantId: z.string().uuid(),
    approvalNote: z.string().trim().max(1000).nullable().optional()
  }),
  z.object({
    action: z.literal("revoke"),
    grantId: z.string().uuid(),
    revokeReason: z.string().trim().min(4).max(1000)
  }),
  z.object({
    action: z.literal("review"),
    grantId: z.string().uuid(),
    reviewNote: z.string().trim().min(8).max(1000)
  })
]);

function serializeGrant(grant: PrivilegedAccessGrant) {
  return {
    id: grant.id,
    tenantKey: grant.tenant_key,
    workspaceKey: grant.workspace_key,
    accessType: grant.access_type,
    status: grant.status,
    subjectEmail: grant.subject_email,
    subjectName: grant.subject_name,
    requestedByUserId: grant.requested_by_user_id,
    approvedByUserId: grant.approved_by_user_id,
    revokedByUserId: grant.revoked_by_user_id,
    reason: grant.reason,
    reference: grant.reference,
    approvalNote: grant.approval_note,
    revokeReason: grant.revoke_reason,
    requestedDurationMinutes: grant.requested_duration_minutes,
    requestedAt: grant.requested_at,
    approvedAt: grant.approved_at,
    revokedAt: grant.revoked_at,
    expiresAt: grant.expires_at,
    createdAt: grant.created_at,
    updatedAt: grant.updated_at,
    metadata: grant.metadata
  };
}

async function requireLeadAdmin({ requireMfa = false }: { requireMfa?: boolean } = {}) {
  const context = await getSessionContext();
  const user = context?.user ?? null;
  if (!isLeadAdmin(user)) {
    return { user: null, response: Response.json({ error: "Forbidden" }, { status: 403 }) };
  }
  if (requireMfa) {
    try {
      await assertSensitiveSessionMfa({ user, authProvider: context?.authProvider ?? null });
    } catch (error) {
      const response = sensitiveSessionErrorResponse(error);
      if (response) return { user: null, response };
      throw error;
    }
  }
  return { user, response: null };
}

function readLimit(request: Request) {
  const value = Number(new URL(request.url).searchParams.get("limit") ?? 25);
  return Number.isFinite(value) ? Math.min(Math.max(Math.trunc(value), 1), 100) : 25;
}

function alertAuditAction(outcome: PrivilegedAccessAlertOutcome) {
  if (outcome.status === "delivered") return "privileged_access_alert_delivered";
  if (outcome.status === "missing_webhook") return "privileged_access_alert_missing";
  return "privileged_access_alert_failed";
}

async function recordPrivilegedAccessAlertAudit({
  scope,
  actorUserId,
  grant,
  outcome
}: {
  scope: TenantScope;
  actorUserId: string | null;
  grant: PrivilegedAccessGrant;
  outcome: PrivilegedAccessAlertOutcome;
}) {
  await recordAuditLog({
    tenantKey: scope.tenantKey,
    workspaceKey: scope.workspaceKey,
    actorUserId,
    action: alertAuditAction(outcome),
    entityType: "privileged_access_grant",
    entityId: grant.id,
    data: {
      event: outcome.event,
      alertStatus: outcome.status,
      delivered: outcome.delivered,
      severity: outcome.severity,
      destination: outcome.destination,
      error: outcome.error ?? null
    }
  }).catch(() => {});
}

async function deliverPrivilegedAccessAlert({
  scope,
  actorUserId,
  grant,
  event
}: {
  scope: TenantScope;
  actorUserId: string | null;
  grant: PrivilegedAccessGrant;
  event: PrivilegedAccessAlertEvent;
}) {
  try {
    const outcome = await sendPrivilegedAccessAlert({ scope, grant, event, actorUserId });
    await recordPrivilegedAccessAlertAudit({ scope, actorUserId, grant, outcome });
  } catch (error) {
    await recordAuditLog({
      tenantKey: scope.tenantKey,
      workspaceKey: scope.workspaceKey,
      actorUserId,
      action: "privileged_access_alert_failed",
      entityType: "privileged_access_grant",
      entityId: grant.id,
      data: {
        event,
        alertStatus: "failed",
        delivered: false,
        severity: grant.access_type === "break_glass" ? "critical" : "high",
        destination: "security_webhook",
        error: error instanceof Error ? error.message.slice(0, 500) : "Unknown alert delivery failure"
      }
    }).catch(() => {});
  }
}

export async function GET(request: Request) {
  const { user, response } = await requireLeadAdmin();
  if (response) return response;
  if (!user) return Response.json({ error: "Forbidden" }, { status: 403 });

  const scope = tenantScopeFromUser(user);
  const [grants, stats] = await Promise.all([
    listPrivilegedAccessGrants(scope, readLimit(request)),
    getPrivilegedAccessStats(scope)
  ]);

  return Response.json({
    grants: grants.map(serializeGrant),
    stats
  });
}

export async function POST(request: Request) {
  const { user, response } = await requireLeadAdmin({ requireMfa: true });
  if (response) return response;
  if (!user) return Response.json({ error: "Forbidden" }, { status: 403 });

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = createGrantSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json({ error: "Invalid payload" }, { status: 400 });
  }

  const scope = tenantScopeFromUser(user);
  try {
    const grant = await createPrivilegedAccessGrant(scope, user?.id ?? null, parsed.data);
    await recordAuditLog({
      tenantKey: scope.tenantKey,
      workspaceKey: scope.workspaceKey,
      actorUserId: user?.id ?? null,
      action: "privileged_access_requested",
      entityType: "privileged_access_grant",
      entityId: grant.id,
      data: {
        accessType: grant.access_type,
        subjectEmail: grant.subject_email,
        requestedDurationMinutes: grant.requested_duration_minutes,
        reference: grant.reference,
        alertSeverity: grant.access_type === "break_glass" ? "critical" : "high"
      }
    });
    await deliverPrivilegedAccessAlert({
      scope,
      actorUserId: user?.id ?? null,
      grant,
      event: "requested"
    });

    return Response.json({ status: "pending", grant: serializeGrant(grant) });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Invalid privileged access request" },
      { status: 400 }
    );
  }
}

export async function PATCH(request: Request) {
  const { user, response } = await requireLeadAdmin({ requireMfa: true });
  if (response) return response;
  if (!user) return Response.json({ error: "Forbidden" }, { status: 403 });

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = updateGrantSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json({ error: "Invalid payload" }, { status: 400 });
  }

  const scope = tenantScopeFromUser(user);
  const grant = await getPrivilegedAccessGrant(scope, parsed.data.grantId);
  if (!grant) {
    return Response.json({ error: "Privileged access grant not found" }, { status: 404 });
  }

  try {
    if (parsed.data.action === "approve") {
      if (grant.access_type === "break_glass") {
        if (!parsed.data.approvalNote?.trim()) {
          return Response.json({ error: "Break-glass approval requires an approval note." }, { status: 400 });
        }
        if (!(await hasActiveMfaFactor(user))) {
          return Response.json({ error: "Break-glass approval requires active admin MFA." }, { status: 403 });
        }
      }

      const approved = await approvePrivilegedAccessGrant(
        scope,
        parsed.data.grantId,
        user?.id ?? "",
        parsed.data.approvalNote
      );
      await recordAuditLog({
        tenantKey: scope.tenantKey,
        workspaceKey: scope.workspaceKey,
        actorUserId: user?.id ?? null,
        action: "privileged_access_approved",
        entityType: "privileged_access_grant",
        entityId: approved.id,
        data: {
          accessType: approved.access_type,
          subjectEmail: approved.subject_email,
          expiresAt: approved.expires_at,
          reference: approved.reference,
          alertSeverity: approved.access_type === "break_glass" ? "critical" : "high"
        }
      });
      await deliverPrivilegedAccessAlert({
        scope,
        actorUserId: user?.id ?? null,
        grant: approved,
        event: "approved"
      });
      return Response.json({ status: "active", grant: serializeGrant(approved) });
    }

    if (parsed.data.action === "review") {
      const reviewed = await reviewPrivilegedAccessGrant(
        scope,
        parsed.data.grantId,
        user?.id ?? "",
        parsed.data.reviewNote
      );
      await recordAuditLog({
        tenantKey: scope.tenantKey,
        workspaceKey: scope.workspaceKey,
        actorUserId: user?.id ?? null,
        action: "privileged_access_reviewed",
        entityType: "privileged_access_grant",
        entityId: reviewed.id,
        data: {
          accessType: reviewed.access_type,
          subjectEmail: reviewed.subject_email,
          reference: reviewed.reference,
          status: reviewed.status
        }
      });
      return Response.json({ status: "reviewed", grant: serializeGrant(reviewed) });
    }

    const revoked = await revokePrivilegedAccessGrant(
      scope,
      parsed.data.grantId,
      user?.id ?? "",
      parsed.data.revokeReason
    );
    await recordAuditLog({
      tenantKey: scope.tenantKey,
      workspaceKey: scope.workspaceKey,
      actorUserId: user?.id ?? null,
      action: "privileged_access_revoked",
      entityType: "privileged_access_grant",
      entityId: revoked.id,
      data: {
        accessType: revoked.access_type,
        subjectEmail: revoked.subject_email,
        revokeReason: revoked.revoke_reason,
        reference: revoked.reference,
        alertSeverity: revoked.access_type === "break_glass" ? "critical" : "high"
      }
    });
    await deliverPrivilegedAccessAlert({
      scope,
      actorUserId: user?.id ?? null,
      grant: revoked,
      event: "revoked"
    });
    return Response.json({ status: "revoked", grant: serializeGrant(revoked) });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Could not update privileged access grant" },
      { status: 400 }
    );
  }
}
