import { db } from "@/server/db";
import { resolveTenantScope, type TenantScopeInput } from "@/server/tenant-context";

export type AiGuardEventRecord = {
  id: string;
  tenant_key: string;
  workspace_key: string;
  run_id: string | null;
  integration_id: string | null;
  source_kind: string;
  source_id: string | null;
  subject: string | null;
  severity: string;
  decision: string;
  reason_codes: string[];
  guard_version: string;
  content_sample: string | null;
  metadata: Record<string, unknown>;
  created_at: Date;
};

export type AiPolicyDecisionRecord = {
  id: string;
  tenant_key: string;
  workspace_key: string;
  run_id: string | null;
  integration_id: string | null;
  policy_mode: string;
  tool_name: string;
  tool_class: string;
  decision: string;
  reason_codes: string[];
  resource: Record<string, unknown>;
  metadata: Record<string, unknown>;
  created_at: Date;
};

export type AiSafetyDiagnostics = {
  summary: {
    guardEvents: number;
    maliciousGuardEvents: number;
    suspiciousGuardEvents: number;
    blockedPolicyDecisions: number;
    reviewPolicyDecisions: number;
    readOnlyPolicyDecisions: number;
  };
  guardEvents: AiGuardEventRecord[];
  policyDecisions: AiPolicyDecisionRecord[];
};

export async function getAiSafetyDiagnostics(
  scopeInput?: TenantScopeInput,
  input: { limit?: number } = {}
): Promise<AiSafetyDiagnostics> {
  const scope = resolveTenantScope(scopeInput);
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
  const [guardEvents, policyDecisions, guardSummary, policySummary] = await Promise.all([
    db.query<AiGuardEventRecord>(
      `SELECT id,
              tenant_key,
              workspace_key,
              run_id,
              integration_id,
              source_kind,
              source_id,
              subject,
              severity,
              decision,
              reason_codes,
              guard_version,
              content_sample,
              metadata,
              created_at
       FROM ai_guard_events
       WHERE tenant_key = $1
         AND workspace_key = $2
       ORDER BY created_at DESC
       LIMIT $3`,
      [scope.tenantKey, scope.workspaceKey, limit]
    ),
    db.query<AiPolicyDecisionRecord>(
      `SELECT id,
              tenant_key,
              workspace_key,
              run_id,
              integration_id,
              policy_mode,
              tool_name,
              tool_class,
              decision,
              reason_codes,
              resource,
              metadata,
              created_at
       FROM ai_policy_decisions
       WHERE tenant_key = $1
         AND workspace_key = $2
       ORDER BY created_at DESC
       LIMIT $3`,
      [scope.tenantKey, scope.workspaceKey, limit]
    ),
    db.query<{
      total: string;
      malicious: string;
      suspicious: string;
    }>(
      `SELECT COUNT(*)::text AS total,
              COUNT(*) FILTER (WHERE severity = 'malicious')::text AS malicious,
              COUNT(*) FILTER (WHERE severity = 'suspicious')::text AS suspicious
       FROM ai_guard_events
       WHERE tenant_key = $1
         AND workspace_key = $2`,
      [scope.tenantKey, scope.workspaceKey]
    ),
    db.query<{
      blocked: string;
      review: string;
      read_only: string;
    }>(
      `SELECT COUNT(*) FILTER (WHERE decision = 'block')::text AS blocked,
              COUNT(*) FILTER (WHERE decision = 'needs_review')::text AS review,
              COUNT(*) FILTER (WHERE decision = 'read_only')::text AS read_only
       FROM ai_policy_decisions
       WHERE tenant_key = $1
         AND workspace_key = $2`,
      [scope.tenantKey, scope.workspaceKey]
    )
  ]);

  return {
    summary: {
      guardEvents: Number.parseInt(guardSummary.rows[0]?.total ?? "0", 10),
      maliciousGuardEvents: Number.parseInt(guardSummary.rows[0]?.malicious ?? "0", 10),
      suspiciousGuardEvents: Number.parseInt(guardSummary.rows[0]?.suspicious ?? "0", 10),
      blockedPolicyDecisions: Number.parseInt(policySummary.rows[0]?.blocked ?? "0", 10),
      reviewPolicyDecisions: Number.parseInt(policySummary.rows[0]?.review ?? "0", 10),
      readOnlyPolicyDecisions: Number.parseInt(policySummary.rows[0]?.read_only ?? "0", 10)
    },
    guardEvents: guardEvents.rows,
    policyDecisions: policyDecisions.rows
  };
}
