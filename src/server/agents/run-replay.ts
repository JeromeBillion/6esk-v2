import { redactPromptSafetySample } from "@/server/ai/prompt-safety";
import { db } from "@/server/db";

type JsonRecord = Record<string, unknown>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SECRET_FIELD_RE =
  /secret|token|password|api[_-]?key|authorization|cookie|signature|credential|private|shared[_-]?secret|access[_-]?token|refresh[_-]?token|verify[_-]?token/i;

export type AgentRunReplayStatus = "complete" | "partial" | "blocked";

type AgentRunReplayRunRow = {
  id: string;
  tenant_id: string;
  integration_id: string | null;
  run_type: string;
  status: string;
  lane_key: string;
  source_channel: string | null;
  resource_type: string | null;
  resource_id: string | null;
  trigger_event_type: string | null;
  trigger_outbox_id: string | null;
  idempotency_key: string | null;
  requested_scopes: unknown;
  rollout_mode: string | null;
  provider_mode: string | null;
  failure_reason: string | null;
  metadata: JsonRecord;
  created_at: Date;
  queued_at: Date | null;
  started_at: Date | null;
  waiting_since: Date | null;
  completed_at: Date | null;
  failed_at: Date | null;
  timed_out_at: Date | null;
  cancelled_at: Date | null;
  lost_at: Date | null;
  updated_at: Date;
};

type AgentRunReplayEventRow = {
  id: string;
  run_id: string;
  sequence: number;
  event_type: string;
  status: string | null;
  summary: string | null;
  event_data: JsonRecord;
  created_at: Date;
};

type AgentRunReplayStepRow = {
  id: string;
  run_id: string;
  step_index: number;
  step_type: string;
  status: string;
  summary: string | null;
  metadata: JsonRecord;
  started_at: Date | null;
  completed_at: Date | null;
  failed_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

type AgentRunReplayToolCallRow = {
  id: string;
  run_id: string;
  step_id: string | null;
  tool_name: string;
  status: string;
  requested_scopes: unknown;
  args_summary: JsonRecord;
  result_summary: JsonRecord;
  idempotency_key: string | null;
  error_message: string | null;
  created_at: Date;
  updated_at: Date;
};

type AgentRunReplayPolicyDecisionRow = {
  id: string;
  integration_id: string | null;
  run_id: string | null;
  policy_mode: string;
  rollout_mode: string | null;
  action_type: string;
  tool_class: string;
  decision: string;
  reason_codes: unknown;
  resource: JsonRecord;
  prompt_safety: JsonRecord;
  metadata: JsonRecord;
  created_at: Date;
};

type AgentRunReplayKnowledgeRetrievalRow = {
  id: string;
  run_id: string | null;
  resource_type: string | null;
  resource_id: string | null;
  query_purpose: string;
  query_summary: string | null;
  filters: JsonRecord;
  result_document_version_ids: string[];
  result_chunk_ids: string[];
  scores: unknown;
  confidence: number | string | null;
  outcome: string;
  usage_metadata: JsonRecord;
  created_at: Date;
};

export type AgentRunReplay = {
  status: AgentRunReplayStatus;
  explanation: string;
  missingEvidence: string[];
  run: AgentRunReplayRunRow;
  evidence: {
    events: AgentRunReplayEventRow[];
    steps: AgentRunReplayStepRow[];
    toolCalls: AgentRunReplayToolCallRow[];
    policyDecisions: AgentRunReplayPolicyDecisionRow[];
    knowledgeRetrievals: AgentRunReplayKnowledgeRetrievalRow[];
  };
};

function normalizeUuid(value: string) {
  const trimmed = value.trim();
  return UUID_RE.test(trimmed) ? trimmed : null;
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function isEmptyRecord(value: unknown) {
  return Object.keys(asRecord(value)).length === 0;
}

function redactValue(value: unknown, depth = 0): unknown {
  if (depth > 8) return "[REDACTED_DEPTH]";
  if (typeof value === "string") return redactPromptSafetySample(value);
  if (value == null || typeof value !== "object") return value;
  if (value instanceof Date) return value;
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => redactValue(item, depth + 1));

  const output: JsonRecord = {};
  for (const [key, child] of Object.entries(value as JsonRecord)) {
    output[key] = SECRET_FIELD_RE.test(key) ? "[REDACTED_SECRET]" : redactValue(child, depth + 1);
  }
  return output;
}

function redactRecord<T extends JsonRecord>(value: T): T {
  return redactValue(value) as T;
}

function redactRun(row: AgentRunReplayRunRow): AgentRunReplayRunRow {
  return {
    ...row,
    metadata: redactRecord(row.metadata)
  };
}

function redactEvents(rows: AgentRunReplayEventRow[]) {
  return rows.map((row) => ({
    ...row,
    event_data: redactRecord(row.event_data)
  }));
}

function redactSteps(rows: AgentRunReplayStepRow[]) {
  return rows.map((row) => ({
    ...row,
    metadata: redactRecord(row.metadata)
  }));
}

function redactToolCalls(rows: AgentRunReplayToolCallRow[]) {
  return rows.map((row) => ({
    ...row,
    args_summary: redactRecord(row.args_summary),
    result_summary: redactRecord(row.result_summary)
  }));
}

function redactPolicyDecisions(rows: AgentRunReplayPolicyDecisionRow[]) {
  return rows.map((row) => ({
    ...row,
    resource: redactRecord(row.resource),
    prompt_safety: redactRecord(row.prompt_safety),
    metadata: redactRecord(row.metadata)
  }));
}

function redactKnowledgeRetrievals(rows: AgentRunReplayKnowledgeRetrievalRow[]) {
  return rows.map((row) => ({
    ...row,
    query_summary: row.query_summary ? redactPromptSafetySample(row.query_summary) : null,
    filters: redactRecord(row.filters),
    usage_metadata: redactRecord(row.usage_metadata)
  }));
}

function findMissingEvidence(input: {
  run: AgentRunReplayRunRow;
  events: AgentRunReplayEventRow[];
  toolCalls: AgentRunReplayToolCallRow[];
  policyDecisions: AgentRunReplayPolicyDecisionRow[];
}) {
  const missing: string[] = [];
  const commandEnvelope = asRecord(input.run.metadata).commandEnvelope;

  if (isEmptyRecord(commandEnvelope)) {
    missing.push("command_envelope");
  }
  if (input.events.length === 0) {
    missing.push("run_events");
  }
  if (input.toolCalls.length > 0 && input.policyDecisions.length === 0) {
    missing.push("tool_policy_decision");
  }

  const completedWithAllowedPolicy =
    ["completed", "failed"].includes(input.run.status) &&
    input.policyDecisions.some((decision) => decision.decision === "allow");
  if (completedWithAllowedPolicy && input.toolCalls.length === 0) {
    missing.push("tool_call_ledger");
  }

  return Array.from(new Set(missing));
}

function deriveReplayStatus(input: {
  run: AgentRunReplayRunRow;
  toolCalls: AgentRunReplayToolCallRow[];
  policyDecisions: AgentRunReplayPolicyDecisionRow[];
  missingEvidence: string[];
}): AgentRunReplayStatus {
  const blocked =
    input.policyDecisions.some((decision) => decision.decision === "block") ||
    input.toolCalls.some((toolCall) => toolCall.status === "denied") ||
    input.run.status === "failed";
  if (blocked) return "blocked";
  return input.missingEvidence.length ? "partial" : "complete";
}

function explanationFor(status: AgentRunReplayStatus, missingEvidence: string[]) {
  if (status === "blocked") {
    return "The run reached a safety, policy, or execution block; inspect policy decisions, tool calls, and run events before retrying.";
  }
  if (missingEvidence.length) {
    return `Replay evidence is incomplete: ${missingEvidence.join(", ")}.`;
  }
  return "Replay evidence is complete enough to reconstruct the run, policy decisions, tool calls, and retrieval context.";
}

export async function getAgentRunReplay({
  tenantId,
  integrationId,
  runId
}: {
  tenantId: string;
  integrationId: string;
  runId: string;
}) {
  const normalizedRunId = normalizeUuid(runId);
  if (!normalizedRunId) return null;

  const runResult = await db.query<AgentRunReplayRunRow>(
    `SELECT id,
            tenant_id,
            integration_id,
            run_type,
            status,
            lane_key,
            source_channel,
            resource_type,
            resource_id,
            trigger_event_type,
            trigger_outbox_id,
            idempotency_key,
            requested_scopes,
            rollout_mode,
            provider_mode,
            failure_reason,
            metadata,
            created_at,
            queued_at,
            started_at,
            waiting_since,
            completed_at,
            failed_at,
            timed_out_at,
            cancelled_at,
            lost_at,
            updated_at
     FROM agent_runs
     WHERE tenant_id = $1
       AND integration_id = $2
       AND id = $3
     LIMIT 1`,
    [tenantId, integrationId, normalizedRunId]
  );
  const run = runResult.rows[0] ?? null;
  if (!run) return null;

  const [events, steps, toolCalls, policyDecisions, knowledgeRetrievals] = await Promise.all([
    db.query<AgentRunReplayEventRow>(
      `SELECT id,
              run_id,
              sequence,
              event_type,
              status,
              summary,
              event_data,
              created_at
       FROM agent_run_events
       WHERE tenant_id = $1
         AND run_id = $2
       ORDER BY sequence ASC`,
      [tenantId, normalizedRunId]
    ),
    db.query<AgentRunReplayStepRow>(
      `SELECT id,
              run_id,
              step_index,
              step_type,
              status,
              summary,
              metadata,
              started_at,
              completed_at,
              failed_at,
              created_at,
              updated_at
       FROM agent_run_steps
       WHERE tenant_id = $1
         AND run_id = $2
       ORDER BY step_index ASC`,
      [tenantId, normalizedRunId]
    ),
    db.query<AgentRunReplayToolCallRow>(
      `SELECT id,
              run_id,
              step_id,
              tool_name,
              status,
              requested_scopes,
              args_summary,
              result_summary,
              idempotency_key,
              error_message,
              created_at,
              updated_at
       FROM agent_tool_calls
       WHERE tenant_id = $1
         AND run_id = $2
       ORDER BY created_at ASC`,
      [tenantId, normalizedRunId]
    ),
    db.query<AgentRunReplayPolicyDecisionRow>(
      `SELECT id,
              integration_id,
              run_id,
              policy_mode,
              rollout_mode,
              action_type,
              tool_class,
              decision,
              reason_codes,
              resource,
              prompt_safety,
              metadata,
              created_at
       FROM agent_tool_policy_decisions
       WHERE tenant_id = $1
         AND run_id = $2
       ORDER BY created_at ASC`,
      [tenantId, normalizedRunId]
    ),
    db.query<AgentRunReplayKnowledgeRetrievalRow>(
      `SELECT id,
              run_id,
              resource_type,
              resource_id,
              query_purpose,
              query_summary,
              filters,
              result_document_version_ids,
              result_chunk_ids,
              scores,
              confidence,
              outcome,
              usage_metadata,
              created_at
       FROM knowledge_retrieval_events
       WHERE tenant_id = $1
         AND run_id = $2
       ORDER BY created_at ASC`,
      [tenantId, normalizedRunId]
    )
  ]);

  const missingEvidence = findMissingEvidence({
    run,
    events: events.rows,
    toolCalls: toolCalls.rows,
    policyDecisions: policyDecisions.rows
  });
  const status = deriveReplayStatus({
    run,
    toolCalls: toolCalls.rows,
    policyDecisions: policyDecisions.rows,
    missingEvidence
  });

  return {
    status,
    explanation: explanationFor(status, missingEvidence),
    missingEvidence,
    run: redactRun(run),
    evidence: {
      events: redactEvents(events.rows),
      steps: redactSteps(steps.rows),
      toolCalls: redactToolCalls(toolCalls.rows),
      policyDecisions: redactPolicyDecisions(policyDecisions.rows),
      knowledgeRetrievals: redactKnowledgeRetrievals(knowledgeRetrievals.rows)
    }
  } satisfies AgentRunReplay;
}
