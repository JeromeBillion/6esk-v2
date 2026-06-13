import type { PrivilegedAccessGrant } from "@/server/auth/privileged-access";
import { db } from "@/server/db";
import { DEFAULT_WORKSPACE_KEY } from "@/server/workspace-modules";

export type PrivilegedAccessAlertEvent = "requested" | "approved" | "revoked";
export type PrivilegedAccessAlertStatus = "delivered" | "missing_webhook" | "failed";

export type PrivilegedAccessAlertOutcome = {
  event: PrivilegedAccessAlertEvent;
  status: PrivilegedAccessAlertStatus;
  delivered: boolean;
  severity: "high" | "critical";
  destination: "security_webhook";
  attemptedAt: string;
  error?: string;
};

type PrivilegedAccessAlertScope = {
  tenantId: string;
  workspaceKey?: string | null;
};

function workspaceKeyFor(scope: PrivilegedAccessAlertScope) {
  return scope.workspaceKey?.trim() || DEFAULT_WORKSPACE_KEY;
}

function alertSeverity(grant: PrivilegedAccessGrant): "high" | "critical" {
  return grant.access_type === "break_glass" ? "critical" : "high";
}

function cleanError(error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown alert delivery failure";
  return message.slice(0, 500);
}

function buildAlertPayload({
  scope,
  grant,
  event,
  actorUserId,
  attemptedAt
}: {
  scope: PrivilegedAccessAlertScope;
  grant: PrivilegedAccessGrant;
  event: PrivilegedAccessAlertEvent;
  actorUserId: string | null;
  attemptedAt: string;
}) {
  const severity = alertSeverity(grant);
  return {
    text: `6esk ${severity} privileged access ${event}: ${grant.access_type} grant for ${grant.subject_email}.`,
    event,
    severity,
    tenantId: scope.tenantId,
    workspaceKey: workspaceKeyFor(scope),
    grantId: grant.id,
    accessType: grant.access_type,
    status: grant.status,
    subjectEmail: grant.subject_email,
    actorUserId,
    reference: grant.reference,
    requestedDurationMinutes: grant.requested_duration_minutes,
    expiresAt: grant.expires_at,
    timestamp: attemptedAt
  };
}

async function appendAlertOutcome(
  scope: PrivilegedAccessAlertScope,
  grantId: string,
  outcome: PrivilegedAccessAlertOutcome
) {
  await db.query(
    `UPDATE privileged_access_grants
     SET metadata = jsonb_set(
           COALESCE(metadata, '{}'::jsonb),
           '{securityAlerts}',
           COALESCE(metadata->'securityAlerts', '[]'::jsonb) || jsonb_build_array($4::jsonb),
           true
         ),
         updated_at = now()
     WHERE id = $1
       AND tenant_id = $2
       AND workspace_key = $3`,
    [grantId, scope.tenantId, workspaceKeyFor(scope), JSON.stringify(outcome)]
  );
}

export async function sendPrivilegedAccessAlert({
  scope,
  grant,
  event,
  actorUserId
}: {
  scope: PrivilegedAccessAlertScope;
  grant: PrivilegedAccessGrant;
  event: PrivilegedAccessAlertEvent;
  actorUserId: string | null;
}): Promise<PrivilegedAccessAlertOutcome> {
  const attemptedAt = new Date().toISOString();
  const webhookUrl = process.env.SECURITY_ALERT_WEBHOOK?.trim();
  const base = {
    event,
    severity: alertSeverity(grant),
    destination: "security_webhook" as const,
    attemptedAt
  };

  if (!webhookUrl) {
    const outcome: PrivilegedAccessAlertOutcome = {
      ...base,
      status: "missing_webhook",
      delivered: false
    };
    await appendAlertOutcome(scope, grant.id, outcome);
    return outcome;
  }

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildAlertPayload({ scope, grant, event, actorUserId, attemptedAt }))
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(body || `Security alert webhook failed with ${response.status}`);
    }

    const outcome: PrivilegedAccessAlertOutcome = {
      ...base,
      status: "delivered",
      delivered: true
    };
    await appendAlertOutcome(scope, grant.id, outcome);
    return outcome;
  } catch (error) {
    const outcome: PrivilegedAccessAlertOutcome = {
      ...base,
      status: "failed",
      delivered: false,
      error: cleanError(error)
    };
    await appendAlertOutcome(scope, grant.id, outcome);
    return outcome;
  }
}
