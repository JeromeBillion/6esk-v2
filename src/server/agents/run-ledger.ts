import { db } from "@/server/db";
import { resolveTenantScope, type TenantScopeInput } from "@/server/tenant-context";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type AgentRunSummary = {
  id: string;
  tenant_key: string;
  workspace_key: string;
  integration_id: string | null;
  mode: string;
  status: string;
  lane_key: string;
  source_event_type: string | null;
  resource: Record<string, unknown>;
  error: string | null;
  queued_at: Date;
  dispatched_at: Date | null;
  completed_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

export function normalizeRunId(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return UUID_PATTERN.test(trimmed) ? trimmed : null;
}

export function extractRunIdFromMetadata(metadata: Record<string, unknown> | null | undefined) {
  if (!metadata) return null;
  return (
    normalizeRunId(metadata.runId) ??
    normalizeRunId(metadata.run_id) ??
    normalizeRunId(metadata.commandRunId) ??
    normalizeRunId(metadata.command_run_id)
  );
}

export async function recordAgentRunEvent(input: {
  runId: string;
  scope: TenantScopeInput;
  eventType: string;
  status?: string | null;
  data?: Record<string, unknown> | null;
}) {
  const scope = resolveTenantScope(input.scope);
  await db.query(
    `INSERT INTO agent_run_events (tenant_key, workspace_key, run_id, event_type, status, data)
     SELECT $2, $3, run.id, $4, $5, $6
     FROM agent_runs run
     WHERE run.id = $1
       AND run.tenant_key = $2
       AND run.workspace_key = $3
     ON CONFLICT DO NOTHING`,
    [
      input.runId,
      scope.tenantKey,
      scope.workspaceKey,
      input.eventType,
      input.status ?? null,
      input.data ?? {}
    ]
  );
}

export async function recordAgentRunStep(input: {
  runId: string;
  scope: TenantScopeInput;
  stepType: string;
  status: string;
  input?: Record<string, unknown> | null;
  output?: Record<string, unknown> | null;
  error?: string | null;
}) {
  const completedAt = input.status === "ok" || input.status === "failed" || input.status === "blocked";
  const scope = resolveTenantScope(input.scope);
  const result = await db.query<{ id: string }>(
    `INSERT INTO agent_run_steps (
       tenant_key,
       workspace_key,
       run_id,
       step_type,
       status,
       input,
       output,
       error,
       completed_at
     )
     SELECT $2, $3, run.id, $4, $5, $6, $7, $8, ${completedAt ? "now()" : "NULL"}
     FROM agent_runs run
     WHERE run.id = $1
       AND run.tenant_key = $2
       AND run.workspace_key = $3
     RETURNING id`,
    [
      input.runId,
      scope.tenantKey,
      scope.workspaceKey,
      input.stepType,
      input.status,
      input.input ?? {},
      input.output ?? {},
      input.error?.slice(0, 500) ?? null
    ]
  );
  return result.rows[0]?.id ?? null;
}

export async function recordAgentToolCall(input: {
  runId: string;
  scope: TenantScopeInput;
  stepId?: string | null;
  toolName: string;
  status: string;
  request?: Record<string, unknown> | null;
  response?: Record<string, unknown> | null;
  error?: string | null;
}) {
  const completedAt = input.status === "ok" || input.status === "failed" || input.status === "blocked";
  const scope = resolveTenantScope(input.scope);
  await db.query(
    `INSERT INTO agent_tool_calls (
       tenant_key,
       workspace_key,
       run_id,
       step_id,
       tool_name,
       status,
       request,
       response,
       error,
       completed_at
     )
     SELECT $2, $3, run.id, $4::uuid, $5, $6, $7, $8, $9, ${completedAt ? "now()" : "NULL"}
     FROM agent_runs run
     WHERE run.id = $1
       AND run.tenant_key = $2
       AND run.workspace_key = $3
       AND (
         $4::uuid IS NULL
         OR EXISTS (
           SELECT 1
           FROM agent_run_steps step
           WHERE step.id = $4::uuid
             AND step.run_id = run.id
             AND step.tenant_key = $2
             AND step.workspace_key = $3
         )
       )`,
    [
      input.runId,
      scope.tenantKey,
      scope.workspaceKey,
      input.stepId ?? null,
      input.toolName,
      input.status,
      input.request ?? {},
      input.response ?? {},
      input.error?.slice(0, 500) ?? null
    ]
  );
}

export async function markAgentRunCompleted(input: {
  runId: string;
  scope: TenantScopeInput;
  status?: "completed" | "failed" | "cancelled";
  error?: string | null;
  data?: Record<string, unknown> | null;
}) {
  const status = input.status ?? "completed";
  const scope = resolveTenantScope(input.scope);
  const result = await db.query<{ id: string }>(
    `UPDATE agent_runs
     SET status = $2,
         error = $3,
         completed_at = COALESCE(completed_at, now()),
         updated_at = now()
     WHERE id = $1
       AND tenant_key = $4
       AND workspace_key = $5
     RETURNING id`,
    [input.runId, status, input.error?.slice(0, 500) ?? null, scope.tenantKey, scope.workspaceKey]
  );
  if (!result.rows[0]?.id) {
    return;
  }
  await recordAgentRunEvent({
    runId: input.runId,
    scope,
    eventType: "agent.run.completed",
    status,
    data: input.data ?? {}
  });
}

export async function listRecentAgentRuns(input: {
  integrationId?: string | null;
  tenantKey?: string | null;
  workspaceKey?: string | null;
  limit?: number;
}) {
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
  const conditions: string[] = [];
  const values: Array<string | number> = [];

  if (input.integrationId) {
    values.push(input.integrationId);
    conditions.push(`integration_id = $${values.length}`);
  }

  if (input.tenantKey) {
    values.push(input.tenantKey);
    conditions.push(`tenant_key = $${values.length}`);
  }

  if (input.workspaceKey) {
    values.push(input.workspaceKey);
    conditions.push(`workspace_key = $${values.length}`);
  }

  values.push(limit);
  const result = await db.query<AgentRunSummary>(
    `SELECT id,
            tenant_key,
            workspace_key,
            integration_id,
            mode,
            status,
            lane_key,
            source_event_type,
            resource,
            error,
            queued_at,
            dispatched_at,
            completed_at,
            created_at,
            updated_at
     FROM agent_runs
     ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
     ORDER BY created_at DESC
     LIMIT $${values.length}`,
    values
  );
  return result.rows;
}
