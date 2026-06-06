import { db } from "@/server/db";
import { redactAiGuardSample } from "@/server/ai/guard";
import { resolveTenantScope, type TenantScopeInput } from "@/server/tenant-context";

type JsonRecord = Record<string, unknown>;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type AgentRunReplayStatus = "complete" | "partial" | "blocked";

export type AgentRunReplayRun = {
  id: string;
  tenant_key: string;
  workspace_key: string;
  integration_id: string | null;
  mode: string;
  status: string;
  lane_key: string;
  source_event_type: string | null;
  resource: JsonRecord;
  command_envelope: JsonRecord;
  idempotency_key: string | null;
  error: string | null;
  queued_at: Date;
  dispatched_at: Date | null;
  completed_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

export type AgentRunReplayEvent = {
  id: string;
  run_id: string;
  event_type: string;
  status: string | null;
  data: JsonRecord;
  created_at: Date;
};

export type AgentRunReplayStep = {
  id: string;
  run_id: string;
  step_type: string;
  status: string;
  input: JsonRecord;
  output: JsonRecord;
  error: string | null;
  started_at: Date;
  completed_at: Date | null;
};

export type AgentRunReplayToolCall = {
  id: string;
  run_id: string;
  step_id: string | null;
  tool_name: string;
  status: string;
  request: JsonRecord;
  response: JsonRecord;
  error: string | null;
  requested_at: Date;
  completed_at: Date | null;
};

export type AgentRunReplayGuardEvent = {
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
  metadata: JsonRecord;
  created_at: Date;
};

export type AgentRunReplayPolicyDecision = {
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
  resource: JsonRecord;
  metadata: JsonRecord;
  created_at: Date;
};

export type AgentRunReplayPromptTemplate = {
  id: string;
  tenant_key: string;
  workspace_key: string;
  template_key: string;
  template_version: string;
  status: string;
  template_hash: string;
  activated_at: Date | null;
  retired_at: Date | null;
  metadata: JsonRecord;
  created_at: Date;
  updated_at: Date;
};

export type AgentRunPolicyReplay = {
  status: AgentRunReplayStatus;
  explanation: string;
  missingEvidence: string[];
  run: AgentRunReplayRun;
  promptSandbox: JsonRecord | null;
  promptTemplate: AgentRunReplayPromptTemplate | null;
  evidence: {
    events: AgentRunReplayEvent[];
    steps: AgentRunReplayStep[];
    toolCalls: AgentRunReplayToolCall[];
    guardEvents: AgentRunReplayGuardEvent[];
    policyDecisions: AgentRunReplayPolicyDecision[];
  };
};

function asRecord(value: unknown): JsonRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as JsonRecord;
}

function normalizeRunId(value: string) {
  const trimmed = value.trim();
  return UUID_PATTERN.test(trimmed) ? trimmed : null;
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isEmptyRecord(value: JsonRecord | null) {
  return !value || Object.keys(value).length === 0;
}

const SECRET_FIELD_PATTERN =
  /secret|token|password|api[_-]?key|authorization|cookie|signature|credential|private|shared[_-]?secret|access[_-]?token|refresh[_-]?token|verify[_-]?token/i;

function redactReplayValue(value: unknown, depth = 0): unknown {
  if (depth > 8) {
    return "[REDACTED_DEPTH]";
  }
  if (typeof value === "string") {
    return redactAiGuardSample(value);
  }
  if (value == null || typeof value !== "object") {
    return value;
  }
  if (value instanceof Date) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 100).map((item) => redactReplayValue(item, depth + 1));
  }

  const redacted: JsonRecord = {};
  for (const [key, child] of Object.entries(value as JsonRecord)) {
    redacted[key] = SECRET_FIELD_PATTERN.test(key)
      ? "[REDACTED_SECRET]"
      : redactReplayValue(child, depth + 1);
  }
  return redacted;
}

function redactRecord(value: JsonRecord): JsonRecord {
  return redactReplayValue(value) as JsonRecord;
}

function extractPromptSandbox(commandEnvelope: JsonRecord | null) {
  return asRecord(commandEnvelope?.prompt_sandbox);
}

function findMissingEvidence(input: {
  run: AgentRunReplayRun;
  promptSandbox: JsonRecord | null;
  promptTemplate: AgentRunReplayPromptTemplate | null;
  events: AgentRunReplayEvent[];
  toolCalls: AgentRunReplayToolCall[];
  policyDecisions: AgentRunReplayPolicyDecision[];
}) {
  const missing: string[] = [];

  if (isEmptyRecord(input.run.command_envelope)) {
    missing.push("command_envelope");
  }
  if (!input.promptSandbox) {
    missing.push("prompt_sandbox");
  }
  if (input.promptSandbox && !input.promptTemplate) {
    missing.push("prompt_template_record");
  }
  if (input.events.length === 0) {
    missing.push("run_events");
  }
  if (input.toolCalls.length > 0 && input.policyDecisions.length === 0) {
    missing.push("tool_policy_decision");
  }

  const allowedToolDecisions = input.policyDecisions.filter((decision) => decision.decision === "allow");
  const terminalRun = ["completed", "failed", "cancelled"].includes(input.run.status);
  if (terminalRun && allowedToolDecisions.length > 0 && input.toolCalls.length === 0) {
    missing.push("tool_call_ledger");
  }

  return missing;
}

function deriveReplayStatus(input: {
  run: AgentRunReplayRun;
  guardEvents: AgentRunReplayGuardEvent[];
  policyDecisions: AgentRunReplayPolicyDecision[];
  toolCalls: AgentRunReplayToolCall[];
  missingEvidence: string[];
}): AgentRunReplayStatus {
  const blocked =
    input.run.status === "blocked" ||
    input.guardEvents.some((event) => event.decision === "block") ||
    input.policyDecisions.some((decision) => decision.decision === "block") ||
    input.toolCalls.some((toolCall) => toolCall.status === "blocked");

  if (blocked) {
    return "blocked";
  }
  return input.missingEvidence.length === 0 ? "complete" : "partial";
}

function explainReplayStatus(status: AgentRunReplayStatus, missingEvidence: string[]) {
  if (status === "blocked") {
    return "The run reached a safety or policy block; inspect guard events and policy decisions before replaying or retrying.";
  }
  if (missingEvidence.length > 0) {
    return `Replay evidence is incomplete: ${missingEvidence.join(", ")}.`;
  }
  return "Replay evidence is complete enough to reconstruct the prompt, policy, run ledger, and tool execution path.";
}

async function findPromptTemplate(input: {
  tenantKey: string;
  workspaceKey: string;
  promptSandbox: JsonRecord | null;
}) {
  const templateKey = readString(input.promptSandbox?.template_key);
  const templateVersion = readString(input.promptSandbox?.template_version);
  if (!templateKey || !templateVersion) {
    return null;
  }

  const result = await db.query<AgentRunReplayPromptTemplate>(
    `SELECT id,
            tenant_key,
            workspace_key,
            template_key,
            template_version,
            status,
            template_hash,
            activated_at,
            retired_at,
            metadata,
            created_at,
            updated_at
     FROM ai_prompt_templates
     WHERE tenant_key = $1
       AND workspace_key = $2
       AND template_key = $3
       AND template_version = $4
     LIMIT 1`,
    [input.tenantKey, input.workspaceKey, templateKey, templateVersion]
  );

  return result.rows[0] ?? null;
}

export async function getAgentPolicyReplay(input: {
  runId: string;
  integrationId: string;
  scope?: TenantScopeInput;
}) {
  const runId = normalizeRunId(input.runId);
  if (!runId) {
    return null;
  }

  const scope = resolveTenantScope(input.scope);
  const runResult = await db.query<AgentRunReplayRun>(
    `SELECT id,
            tenant_key,
            workspace_key,
            integration_id,
            mode,
            status,
            lane_key,
            source_event_type,
            resource,
            command_envelope,
            idempotency_key,
            error,
            queued_at,
            dispatched_at,
            completed_at,
            created_at,
            updated_at
     FROM agent_runs
     WHERE id = $1
       AND integration_id = $2
       AND tenant_key = $3
       AND workspace_key = $4
     LIMIT 1`,
    [runId, input.integrationId, scope.tenantKey, scope.workspaceKey]
  );
  const run = runResult.rows[0];
  if (!run) {
    return null;
  }

  const commandEnvelope = asRecord(run.command_envelope);
  const promptSandbox = extractPromptSandbox(commandEnvelope);
  const [events, steps, toolCalls, guardEvents, policyDecisions, promptTemplate] =
    await Promise.all([
      db.query<AgentRunReplayEvent>(
        `SELECT id, run_id, event_type, status, data, created_at
         FROM agent_run_events
         WHERE tenant_key = $1
           AND workspace_key = $2
           AND run_id = $3
         ORDER BY created_at ASC`,
        [scope.tenantKey, scope.workspaceKey, run.id]
      ),
      db.query<AgentRunReplayStep>(
        `SELECT id, run_id, step_type, status, input, output, error, started_at, completed_at
         FROM agent_run_steps
         WHERE tenant_key = $1
           AND workspace_key = $2
           AND run_id = $3
         ORDER BY started_at ASC`,
        [scope.tenantKey, scope.workspaceKey, run.id]
      ),
      db.query<AgentRunReplayToolCall>(
        `SELECT id,
                run_id,
                step_id,
                tool_name,
                status,
                request,
                response,
                error,
                requested_at,
                completed_at
         FROM agent_tool_calls
         WHERE tenant_key = $1
           AND workspace_key = $2
           AND run_id = $3
         ORDER BY requested_at ASC`,
        [scope.tenantKey, scope.workspaceKey, run.id]
      ),
      db.query<AgentRunReplayGuardEvent>(
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
           AND run_id = $3
         ORDER BY created_at ASC`,
        [scope.tenantKey, scope.workspaceKey, run.id]
      ),
      db.query<AgentRunReplayPolicyDecision>(
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
           AND run_id = $3
         ORDER BY created_at ASC`,
        [scope.tenantKey, scope.workspaceKey, run.id]
      ),
      findPromptTemplate({
        tenantKey: scope.tenantKey,
        workspaceKey: scope.workspaceKey,
        promptSandbox
      })
    ]);

  const missingEvidence = findMissingEvidence({
    run,
    promptSandbox,
    promptTemplate,
    events: events.rows,
    toolCalls: toolCalls.rows,
    policyDecisions: policyDecisions.rows
  });
  const status = deriveReplayStatus({
    run,
    guardEvents: guardEvents.rows,
    policyDecisions: policyDecisions.rows,
    toolCalls: toolCalls.rows,
    missingEvidence
  });
  const safeRun = {
    ...run,
    resource: redactRecord(run.resource),
    command_envelope: redactRecord(run.command_envelope)
  };
  const safePromptSandbox = promptSandbox ? redactRecord(promptSandbox) : null;

  return {
    status,
    explanation: explainReplayStatus(status, missingEvidence),
    missingEvidence,
    run: safeRun,
    promptSandbox: safePromptSandbox,
    promptTemplate,
    evidence: {
      events: events.rows.map((event) => ({
        ...event,
        data: redactRecord(event.data)
      })),
      steps: steps.rows.map((step) => ({
        ...step,
        input: redactRecord(step.input),
        output: redactRecord(step.output)
      })),
      toolCalls: toolCalls.rows.map((toolCall) => ({
        ...toolCall,
        request: redactRecord(toolCall.request),
        response: redactRecord(toolCall.response)
      })),
      guardEvents: guardEvents.rows.map((event) => ({
        ...event,
        metadata: redactRecord(event.metadata)
      })),
      policyDecisions: policyDecisions.rows.map((decision) => ({
        ...decision,
        resource: redactRecord(decision.resource),
        metadata: redactRecord(decision.metadata)
      }))
    }
  } satisfies AgentRunPolicyReplay;
}
