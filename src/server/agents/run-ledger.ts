import {
  buildDexterCommandEnvelope,
  buildOutboxRunCreateCommand,
  type DexterCommandData,
  type DexterCommandEnvelope,
  type DexterCommandName
} from "@/server/agents/command-envelope";
import { db } from "@/server/db";

export type AgentRunStatus =
  | "created"
  | "queued"
  | "running"
  | "waiting_approval"
  | "completed"
  | "failed"
  | "timed_out"
  | "cancelled"
  | "lost";

export const AGENT_RUN_STATUSES: AgentRunStatus[] = [
  "created",
  "queued",
  "running",
  "waiting_approval",
  "completed",
  "failed",
  "timed_out",
  "cancelled",
  "lost"
];

type Queryable = Pick<typeof db, "query">;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const DEFAULT_AGENT_RUN_STALE_SECONDS = 900;
export const DEFAULT_AGENT_APPROVAL_STALE_SECONDS = 86400;
export const DEFAULT_AGENT_RUN_RECOVERY_LIMIT = 25;
export const MAX_STALE_AGENT_RUN_RECOVERY_LIMIT = 100;

type CreateOutboxRunInput = {
  client?: Queryable;
  tenantId: string;
  integrationId: string;
  outboxEventId: string;
  eventType: string;
  payload: Record<string, unknown>;
};

type AgentRunRow = {
  id: string;
  tenant_id: string;
  status: AgentRunStatus;
  lane_key: string;
};

type AgentRunReservationRow = {
  reserved: boolean;
  id: string;
  lane_key: string;
  blocked_by_run_id: string | null;
};

export type StaleAgentRunRecoveryRow = {
  id: string;
  tenant_id: string;
  integration_id: string | null;
  previous_status: AgentRunStatus;
  recovered_status: AgentRunStatus;
  lane_key: string;
  trigger_outbox_id: string | null;
  previous_outbox_status: string | null;
  recovered_outbox_status: string | null;
  previous_attempt_count: number | string | null;
  recovered_attempt_count: number | string | null;
  outbox_recovery_action: "retry_queued" | "dead_lettered" | "none";
};

export type AgentRunCancellationResult = {
  cancelled: boolean;
  reason: "cancelled" | "not_found" | "not_cancellable";
  runId: string;
  previousStatus?: AgentRunStatus;
  cancelledSteps: number;
  cancelledToolCalls: number;
  cancelledOutboxEvents: number;
};

export type AgentToolCallLedger = {
  tenantId: string;
  runId: string;
  stepId: string;
  toolCallId: string;
  toolName: string;
};

export type AgentRunStepStatus =
  | "completed"
  | "failed"
  | "skipped"
  | "cancelled";

export type AgentRunStepLedger = {
  tenantId: string;
  runId: string;
  stepId: string;
  stepType: string;
};

type AgentRunCommandContextRow = {
  id: string;
  tenant_id: string;
  integration_id: string | null;
  lane_key: string;
  source_channel: string | null;
  resource_type: string | null;
  resource_id: string | null;
  trigger_event_type: string | null;
  trigger_outbox_id: string | null;
  requested_scopes: unknown;
  rollout_mode: string | null;
  provider_mode: string | null;
};

export type AgentRunListRow = {
  id: string;
  tenant_id: string;
  integration_id: string | null;
  run_type: string;
  status: AgentRunStatus;
  lane_key: string;
  source_channel: string | null;
  resource_type: string | null;
  resource_id: string | null;
  trigger_event_type: string | null;
  trigger_outbox_id: string | null;
  idempotency_key: string | null;
  rollout_mode: string | null;
  provider_mode: string | null;
  failure_reason: string | null;
  created_at: Date | string | null;
  queued_at: Date | string | null;
  started_at: Date | string | null;
  completed_at: Date | string | null;
  failed_at: Date | string | null;
  updated_at: Date | string | null;
};

function queryable(client?: Queryable) {
  return client ?? db;
}

function normalizePositiveInteger(value: number | null | undefined, fallback: number) {
  if (!Number.isFinite(value) || !value || value <= 0) return fallback;
  return Math.floor(value);
}

function normalizeLimit(value: number | null | undefined, fallback: number, max: number) {
  return Math.min(Math.max(normalizePositiveInteger(value, fallback), 1), max);
}

function toNumber(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function safeJsonSummary(value: Record<string, unknown> | null | undefined) {
  const summary = value ?? {};
  try {
    const serialized = JSON.stringify(summary);
    if (serialized.length <= 3500) return summary;
    return {
      truncated: true,
      originalBytes: serialized.length,
      preview: serialized.slice(0, 500)
    };
  } catch {
    return { unserializable: true };
  }
}

function normalizeCancelReason(reason: string | null | undefined) {
  const normalized = typeof reason === "string" ? reason.trim() : "";
  return (normalized || "Cancelled by admin operator.").slice(0, 500);
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readUuid(value: unknown) {
  const text = readString(value);
  return text && UUID_RE.test(text) ? text : null;
}

function inferSourceChannel(eventType: string, payload: Record<string, unknown>) {
  const explicit = readString(payload.sourceChannel) ?? readString(payload.source_channel);
  if (explicit) return explicit.slice(0, 80);

  const [prefix] = eventType.split(".");
  if (prefix === "ticket" || prefix === "tickets") return "ticket";
  if (prefix === "message" || prefix === "messages") return "message";
  if (prefix === "whatsapp") return "whatsapp";
  if (prefix === "call" || prefix === "calls") return "voice";
  if (prefix === "email" || prefix === "mailbox") return "email";
  return prefix?.slice(0, 80) || "agent";
}

function inferResource(payload: Record<string, unknown>) {
  const resource = readRecord(payload.resource);
  const source = resource ?? payload;
  const explicitType = readString(source.resourceType) ?? readString(source.resource_type);
  const explicitId = readUuid(source.resourceId) ?? readUuid(source.resource_id);

  if (explicitType && explicitId) {
    return { resourceType: explicitType.slice(0, 80), resourceId: explicitId };
  }

  const candidates: Array<[string, unknown]> = [
    ["ticket", source.ticket_id ?? source.ticketId],
    ["message", source.message_id ?? source.messageId],
    ["customer", source.customer_id ?? source.customerId],
    ["call", source.call_id ?? source.callId],
    ["thread", source.thread_id ?? source.threadId]
  ];
  for (const [resourceType, value] of candidates) {
    const resourceId = readUuid(value);
    if (resourceId) {
      return { resourceType, resourceId };
    }
  }
  return {
    resourceType: explicitType?.slice(0, 80) ?? null,
    resourceId: null
  };
}

function buildLaneKey({
  tenantId,
  integrationId,
  resourceType,
  resourceId
}: {
  tenantId: string;
  integrationId: string;
  resourceType: string | null;
  resourceId: string | null;
}) {
  if (resourceType && resourceId) {
    return `tenant:${tenantId}:${resourceType}:${resourceId}`;
  }
  return `tenant:${tenantId}:agent:${integrationId}`;
}

function readJsonArray(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function normalizeJsonArray(value: unknown) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function readPayloadSchema(payload: Record<string, unknown>) {
  return readString(payload.schema) ?? readString(payload.schema_version) ?? null;
}

function runMetadata(payload: Record<string, unknown>, outboxEventId: string) {
  const resource = readRecord(payload.resource);
  return {
    outboxEventId,
    payloadSchema: readPayloadSchema(payload),
    resourceKeys: resource ? Object.keys(resource).sort().slice(0, 20) : []
  };
}

export function deriveAgentRunContext(input: {
  tenantId: string;
  integrationId: string;
  eventType: string;
  payload: Record<string, unknown>;
}) {
  const { resourceType, resourceId } = inferResource(input.payload);
  return {
    sourceChannel: inferSourceChannel(input.eventType, input.payload),
    resourceType,
    resourceId,
    idempotencyKey:
      readString(input.payload.idempotencyKey) ??
      readString(input.payload.idempotency_key) ??
      null,
    requestedScopes: readJsonArray(input.payload.requestedScopes ?? input.payload.requested_scopes),
    rolloutMode:
      readString(input.payload.rolloutMode) ??
      readString(input.payload.rollout_mode) ??
      null,
    providerMode:
      readString(input.payload.providerMode) ??
      readString(input.payload.provider_mode) ??
      null,
    laneKey: buildLaneKey({
      tenantId: input.tenantId,
      integrationId: input.integrationId,
      resourceType,
      resourceId
    })
  };
}

export async function appendAgentRunEvent({
  client,
  tenantId,
  runId,
  eventType,
  status,
  summary,
  eventData
}: {
  client?: Queryable;
  tenantId: string;
  runId: string;
  eventType: string;
  status?: AgentRunStatus | null;
  summary?: string | null;
  eventData?: Record<string, unknown>;
}) {
  await queryable(client).query(
    `WITH locked_run AS (
       SELECT id
       FROM agent_runs
       WHERE tenant_id = $1
         AND id = $2
       FOR UPDATE
     ),
     next_sequence AS (
       SELECT COALESCE(MAX(sequence), 0) + 1 AS value
       FROM agent_run_events
       WHERE tenant_id = $1
         AND run_id = $2
     )
     INSERT INTO agent_run_events (
       tenant_id, run_id, sequence, event_type, status, summary, event_data
     )
     SELECT $1, $2, value, $3, $4, $5, $6::jsonb
     FROM locked_run, next_sequence`,
    [
      tenantId,
      runId,
      eventType,
      status ?? null,
      summary?.slice(0, 500) ?? null,
      JSON.stringify(eventData ?? {})
    ]
  );
}

async function getAgentRunCommandContext(client: Queryable, tenantId: string, runId: string) {
  const result = await client.query<AgentRunCommandContextRow>(
    `SELECT id,
            tenant_id,
            integration_id,
            lane_key,
            source_channel,
            resource_type,
            resource_id,
            trigger_event_type,
            trigger_outbox_id,
            requested_scopes,
            rollout_mode,
            provider_mode
     FROM agent_runs
     WHERE tenant_id = $1
       AND id = $2
     LIMIT 1`,
    [tenantId, runId]
  );
  return result.rows[0] ?? null;
}

function fallbackCommandContext(tenantId: string, runId: string): AgentRunCommandContextRow {
  return {
    id: runId,
    tenant_id: tenantId,
    integration_id: null,
    lane_key: `tenant:${tenantId}:run:${runId}`,
    source_channel: "agent",
    resource_type: null,
    resource_id: null,
    trigger_event_type: "agent.run",
    trigger_outbox_id: null,
    requested_scopes: [],
    rollout_mode: "draft_only",
    provider_mode: "managed"
  };
}

export async function appendAgentRunControlPlaneCommand({
  client,
  tenantId,
  runId,
  command,
  eventType,
  status,
  summary,
  actor,
  idempotencyKey,
  requestedScopes,
  commandData,
  eventData
}: {
  client?: Queryable;
  tenantId: string;
  runId: string;
  command: DexterCommandName;
  eventType?: string | null;
  status?: AgentRunStatus | null;
  summary?: string | null;
  actor?: DexterCommandEnvelope["actor"];
  idempotencyKey?: string | null;
  requestedScopes?: unknown;
  commandData?: DexterCommandData | null;
  eventData?: Record<string, unknown>;
}) {
  const activeClient = queryable(client);
  const context = (await getAgentRunCommandContext(activeClient, tenantId, runId)) ?? fallbackCommandContext(tenantId, runId);
  const commandEnvelope = buildDexterCommandEnvelope({
    command,
    tenantId,
    runId,
    actor: actor ?? {
      type: "system",
      displayName: "6esk Dexter control plane"
    },
    idempotencyKey: idempotencyKey ?? `${runId}:${command}:${eventType ?? command}`,
    sourceChannel: context.source_channel ?? "agent",
    triggerEventType: eventType ?? command,
    outboxEventId: context.trigger_outbox_id,
    resourceRefs:
      context.resource_type && context.resource_id
        ? [{ type: context.resource_type, id: context.resource_id }]
        : [],
    requestedScopes: requestedScopes ?? normalizeJsonArray(context.requested_scopes),
    rolloutMode: context.rollout_mode,
    providerMode: context.provider_mode,
    laneKey: context.lane_key,
    commandData
  });

  await appendAgentRunEvent({
    client: activeClient,
    tenantId,
    runId,
    eventType: eventType ?? command,
    status,
    summary,
    eventData: {
      ...(eventData ?? {}),
      commandEnvelope
    }
  });

  return commandEnvelope;
}

export function appendAgentRunCancelCommand(input: {
  client?: Queryable;
  tenantId: string;
  runId: string;
  actor?: DexterCommandEnvelope["actor"];
  reason?: string | null;
}) {
  return appendAgentRunControlPlaneCommand({
    ...input,
    command: "agent.run.cancel",
    eventType: "agent.run.cancel",
    status: "cancelled",
    summary: "Agent run cancellation requested",
    commandData: input.reason ? { reason: input.reason } : undefined
  });
}

export function appendAgentRunWaitCommand(input: {
  client?: Queryable;
  tenantId: string;
  runId: string;
  actor?: DexterCommandEnvelope["actor"];
  waitReason: string;
}) {
  return appendAgentRunControlPlaneCommand({
    ...input,
    command: "agent.wait",
    eventType: "agent.wait",
    status: "waiting_approval",
    summary: "Agent run waiting",
    commandData: { waitReason: input.waitReason }
  });
}

export function appendAgentToolRequestedCommand(input: {
  client?: Queryable;
  tenantId: string;
  runId: string;
  actor?: DexterCommandEnvelope["actor"];
  toolName: string;
  toolCallId?: string | null;
  requestedScopes?: unknown;
  idempotencyKey?: string | null;
  metadata?: Record<string, unknown> | null;
}) {
  return appendAgentRunControlPlaneCommand({
    ...input,
    command: "agent.tool.requested",
    eventType: "agent.tool.requested",
    status: "running",
    summary: `Agent tool requested: ${input.toolName}`,
    commandData: {
      toolName: input.toolName,
      ...(input.toolCallId ? { toolCallId: input.toolCallId } : {}),
      ...(input.metadata ? { metadata: input.metadata } : {})
    }
  });
}

export function appendAgentToolCompletedCommand(input: {
  client?: Queryable;
  tenantId: string;
  runId: string;
  actor?: DexterCommandEnvelope["actor"];
  toolName: string;
  toolCallId?: string | null;
  resultSummary?: Record<string, unknown> | null;
}) {
  return appendAgentRunControlPlaneCommand({
    ...input,
    command: "agent.tool.completed",
    eventType: "agent.tool.completed",
    status: "running",
    summary: `Agent tool completed: ${input.toolName}`,
    commandData: {
      toolName: input.toolName,
      ...(input.toolCallId ? { toolCallId: input.toolCallId } : {}),
      ...(input.resultSummary ? { resultSummary: input.resultSummary } : {})
    }
  });
}

export async function recordAgentRunStepStarted(input: {
  tenantId: string;
  runId: string;
  stepType: string;
  summary?: string | null;
  metadata?: Record<string, unknown> | null;
}): Promise<AgentRunStepLedger> {
  const client = await db.connect();
  const stepType = input.stepType.slice(0, 120);
  try {
    await client.query("BEGIN");
    const stepResult = await client.query<{ id: string }>(
      `WITH locked_run AS (
         SELECT id
         FROM agent_runs
         WHERE tenant_id = $1
           AND id = $2
         FOR UPDATE
       ),
       next_step AS (
         SELECT COALESCE(MAX(step_index), -1) + 1 AS value
         FROM agent_run_steps
         WHERE tenant_id = $1
           AND run_id = $2
       )
       INSERT INTO agent_run_steps (
         tenant_id, run_id, step_index, step_type, status, summary, metadata, started_at
       )
       SELECT $1, $2, next_step.value, $3, 'running', $4, $5::jsonb, now()
       FROM locked_run, next_step
       RETURNING id`,
      [
        input.tenantId,
        input.runId,
        stepType,
        input.summary?.slice(0, 500) ?? `Agent run step started: ${stepType}`.slice(0, 500),
        JSON.stringify(safeJsonSummary(input.metadata))
      ]
    );
    const stepId = stepResult.rows[0]?.id;
    if (!stepId) {
      throw new Error("Agent run not found for step ledger start.");
    }

    await appendAgentRunEvent({
      client,
      tenantId: input.tenantId,
      runId: input.runId,
      eventType: "agent.step.started",
      status: "running",
      summary: `Agent run step started: ${stepType}`,
      eventData: {
        stepId,
        stepType,
        metadata: safeJsonSummary(input.metadata)
      }
    });

    await client.query("COMMIT");
    return {
      tenantId: input.tenantId,
      runId: input.runId,
      stepId,
      stepType
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function completeAgentRunStep(input: {
  ledger: AgentRunStepLedger;
  status: AgentRunStepStatus;
  resultSummary?: Record<string, unknown> | null;
  errorMessage?: string | null;
}) {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE agent_run_steps
       SET status = $3,
           completed_at = CASE WHEN $3 IN ('completed', 'skipped', 'cancelled') THEN now() ELSE completed_at END,
           failed_at = CASE WHEN $3 = 'failed' THEN now() ELSE failed_at END,
           metadata = metadata || $4::jsonb,
           updated_at = now()
       WHERE tenant_id = $1
         AND id = $2`,
      [
        input.ledger.tenantId,
        input.ledger.stepId,
        input.status,
        JSON.stringify({
          resultStatus: input.status,
          resultSummary: safeJsonSummary(input.resultSummary),
          ...(input.errorMessage ? { errorMessage: input.errorMessage.slice(0, 500) } : {})
        })
      ]
    );

    await appendAgentRunEvent({
      client,
      tenantId: input.ledger.tenantId,
      runId: input.ledger.runId,
      eventType: input.status === "failed" ? "agent.step.failed" : "agent.step.completed",
      status: "running",
      summary:
        input.status === "failed"
          ? `Agent run step failed: ${input.ledger.stepType}`
          : `Agent run step completed: ${input.ledger.stepType}`,
      eventData: {
        stepId: input.ledger.stepId,
        stepType: input.ledger.stepType,
        resultStatus: input.status,
        resultSummary: safeJsonSummary(input.resultSummary),
        errorMessage: input.errorMessage?.slice(0, 500) ?? null
      }
    });

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function recordAgentToolCallRequested(input: {
  tenantId: string;
  runId: string;
  toolName: string;
  actor?: DexterCommandEnvelope["actor"];
  requestedScopes?: unknown;
  argsSummary?: Record<string, unknown> | null;
  idempotencyKey?: string | null;
  metadata?: Record<string, unknown> | null;
}): Promise<AgentToolCallLedger> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const stepResult = await client.query<{ id: string }>(
      `WITH locked_run AS (
         SELECT id
         FROM agent_runs
         WHERE tenant_id = $1
           AND id = $2
         FOR UPDATE
       ),
       next_step AS (
         SELECT COALESCE(MAX(step_index), -1) + 1 AS value
         FROM agent_run_steps
         WHERE tenant_id = $1
           AND run_id = $2
       )
       INSERT INTO agent_run_steps (
         tenant_id, run_id, step_index, step_type, status, summary, metadata, started_at
       )
       SELECT $1, $2, next_step.value, $3, 'running', $4, $5::jsonb, now()
       FROM locked_run, next_step
       RETURNING id`,
      [
        input.tenantId,
        input.runId,
        `tool:${input.toolName}`,
        `Agent tool started: ${input.toolName}`.slice(0, 500),
        JSON.stringify({
          toolName: input.toolName,
          ...(input.metadata ?? {})
        })
      ]
    );
    const stepId = stepResult.rows[0]?.id;
    if (!stepId) {
      throw new Error("Agent run not found for tool-call ledger start.");
    }

    const toolResult = await client.query<{ id: string }>(
      `INSERT INTO agent_tool_calls (
         tenant_id, run_id, step_id, tool_name, status, requested_scopes,
         args_summary, idempotency_key
       )
       VALUES ($1, $2, $3, $4, 'running', $5::jsonb, $6::jsonb, $7)
       RETURNING id`,
      [
        input.tenantId,
        input.runId,
        stepId,
        input.toolName,
        JSON.stringify(normalizeJsonArray(input.requestedScopes)),
        JSON.stringify(safeJsonSummary(input.argsSummary)),
        input.idempotencyKey ?? null
      ]
    );
    const toolCallId = toolResult.rows[0]?.id;
    if (!toolCallId) {
      throw new Error("Agent tool-call ledger start failed.");
    }

    await appendAgentToolRequestedCommand({
      client,
      tenantId: input.tenantId,
      runId: input.runId,
      actor: input.actor,
      toolName: input.toolName,
      toolCallId,
      requestedScopes: input.requestedScopes,
      idempotencyKey: input.idempotencyKey,
      metadata: input.metadata
    });

    await client.query("COMMIT");
    return {
      tenantId: input.tenantId,
      runId: input.runId,
      stepId,
      toolCallId,
      toolName: input.toolName
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function recordAgentToolCallDenied(input: {
  tenantId: string;
  runId: string;
  toolName: string;
  requestedScopes?: unknown;
  argsSummary?: Record<string, unknown> | null;
  idempotencyKey?: string | null;
  reason: string;
  metadata?: Record<string, unknown> | null;
}) {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const stepResult = await client.query<{ id: string }>(
      `WITH locked_run AS (
         SELECT id
         FROM agent_runs
         WHERE tenant_id = $1
           AND id = $2
         FOR UPDATE
       ),
       next_step AS (
         SELECT COALESCE(MAX(step_index), -1) + 1 AS value
         FROM agent_run_steps
         WHERE tenant_id = $1
           AND run_id = $2
       )
       INSERT INTO agent_run_steps (
         tenant_id, run_id, step_index, step_type, status, summary, metadata, started_at, completed_at
       )
       SELECT $1, $2, next_step.value, $3, 'skipped', $4, $5::jsonb, now(), now()
       FROM locked_run, next_step
       RETURNING id`,
      [
        input.tenantId,
        input.runId,
        `tool:${input.toolName}`,
        `Agent tool denied: ${input.toolName}`.slice(0, 500),
        JSON.stringify({
          toolName: input.toolName,
          denialReason: input.reason.slice(0, 500),
          ...(input.metadata ?? {})
        })
      ]
    );
    const stepId = stepResult.rows[0]?.id;
    if (!stepId) {
      throw new Error("Agent run not found for denied tool-call ledger.");
    }

    const toolResult = await client.query<{ id: string }>(
      `INSERT INTO agent_tool_calls (
         tenant_id, run_id, step_id, tool_name, status, requested_scopes,
         args_summary, idempotency_key, error_message
       )
       VALUES ($1, $2, $3, $4, 'denied', $5::jsonb, $6::jsonb, $7, $8)
       RETURNING id`,
      [
        input.tenantId,
        input.runId,
        stepId,
        input.toolName,
        JSON.stringify(normalizeJsonArray(input.requestedScopes)),
        JSON.stringify(safeJsonSummary(input.argsSummary)),
        input.idempotencyKey ?? null,
        input.reason.slice(0, 500)
      ]
    );

    await appendAgentRunEvent({
      client,
      tenantId: input.tenantId,
      runId: input.runId,
      eventType: "agent.tool.denied",
      status: "running",
      summary: `Agent tool denied: ${input.toolName}`,
      eventData: {
        toolName: input.toolName,
        toolCallId: toolResult.rows[0]?.id ?? null,
        reason: input.reason.slice(0, 500),
        metadata: input.metadata ?? {}
      }
    });

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function completeAgentToolCall(input: {
  ledger: AgentToolCallLedger;
  status: "completed" | "failed";
  resultSummary?: Record<string, unknown> | null;
  errorMessage?: string | null;
}) {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE agent_tool_calls
       SET status = $3,
           result_summary = $4::jsonb,
           error_message = $5,
           updated_at = now()
       WHERE tenant_id = $1
         AND id = $2`,
      [
        input.ledger.tenantId,
        input.ledger.toolCallId,
        input.status,
        JSON.stringify(safeJsonSummary(input.resultSummary)),
        input.errorMessage?.slice(0, 500) ?? null
      ]
    );
    await client.query(
      `UPDATE agent_run_steps
       SET status = $3,
           completed_at = CASE WHEN $3 = 'completed' THEN now() ELSE completed_at END,
           failed_at = CASE WHEN $3 = 'failed' THEN now() ELSE failed_at END,
           metadata = metadata || $4::jsonb,
           updated_at = now()
       WHERE tenant_id = $1
         AND id = $2`,
      [
        input.ledger.tenantId,
        input.ledger.stepId,
        input.status,
        JSON.stringify({
          resultStatus: input.status,
          ...(input.errorMessage ? { errorMessage: input.errorMessage.slice(0, 500) } : {})
        })
      ]
    );

    if (input.status === "completed") {
      await appendAgentToolCompletedCommand({
        client,
        tenantId: input.ledger.tenantId,
        runId: input.ledger.runId,
        toolName: input.ledger.toolName,
        toolCallId: input.ledger.toolCallId,
        resultSummary: safeJsonSummary(input.resultSummary)
      });
    } else {
      await appendAgentRunEvent({
        client,
        tenantId: input.ledger.tenantId,
        runId: input.ledger.runId,
        eventType: "agent.tool.failed",
        status: "running",
        summary: `Agent tool failed: ${input.ledger.toolName}`,
        eventData: {
          toolName: input.ledger.toolName,
          toolCallId: input.ledger.toolCallId,
          errorMessage: input.errorMessage?.slice(0, 500) ?? null,
          resultSummary: safeJsonSummary(input.resultSummary)
        }
      });
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export function appendAgentApprovalRequestedCommand(input: {
  client?: Queryable;
  tenantId: string;
  runId: string;
  actor?: DexterCommandEnvelope["actor"];
  approvalId?: string | null;
  reason: string;
  metadata?: Record<string, unknown> | null;
}) {
  return appendAgentRunControlPlaneCommand({
    ...input,
    command: "agent.approval.requested",
    eventType: "agent.approval.requested",
    status: "waiting_approval",
    summary: "Agent approval requested",
    commandData: {
      reason: input.reason,
      ...(input.approvalId ? { approvalId: input.approvalId } : {}),
      ...(input.metadata ? { metadata: input.metadata } : {})
    }
  });
}

export async function createAgentRunForOutbox(input: CreateOutboxRunInput) {
  const context = deriveAgentRunContext(input);
  const client = queryable(input.client);
  const result = await client.query<AgentRunRow>(
    `INSERT INTO agent_runs (
       tenant_id, integration_id, run_type, status, lane_key, source_channel,
       resource_type, resource_id, trigger_event_type, trigger_outbox_id,
       idempotency_key, requested_scopes, rollout_mode, provider_mode,
       metadata, queued_at
     )
     VALUES (
       $1, $2, 'outbox_event', 'queued', $3, $4,
       $5, $6, $7, $8,
       $9, $10::jsonb, $11, $12,
       $13::jsonb, now()
     )
     RETURNING id, tenant_id, status, lane_key`,
    [
      input.tenantId,
      input.integrationId,
      context.laneKey,
      context.sourceChannel,
      context.resourceType,
      context.resourceId,
      input.eventType,
      input.outboxEventId,
      context.idempotencyKey,
      JSON.stringify(context.requestedScopes),
      context.rolloutMode,
      context.providerMode,
      JSON.stringify(runMetadata(input.payload, input.outboxEventId))
    ]
  );
  const run = result.rows[0];
  const commandEnvelope = buildOutboxRunCreateCommand({
    tenantId: input.tenantId,
    integrationId: input.integrationId,
    runId: run.id,
    outboxEventId: input.outboxEventId,
    eventType: input.eventType,
    sourceChannel: context.sourceChannel,
    resourceType: context.resourceType,
    resourceId: context.resourceId,
    idempotencyKey: context.idempotencyKey,
    requestedScopes: context.requestedScopes,
    rolloutMode: context.rolloutMode,
    providerMode: context.providerMode,
    laneKey: run.lane_key,
    payloadSchema: readPayloadSchema(input.payload)
  });

  await client.query(
    `UPDATE agent_runs
     SET idempotency_key = $3,
         requested_scopes = $4::jsonb,
         rollout_mode = $5,
         provider_mode = $6,
         metadata = metadata || $7::jsonb,
         updated_at = now()
     WHERE tenant_id = $1
       AND id = $2`,
    [
      input.tenantId,
      run.id,
      commandEnvelope.idempotencyKey,
      JSON.stringify(commandEnvelope.requestedScopes),
      commandEnvelope.rolloutMode,
      commandEnvelope.providerMode,
      JSON.stringify({ commandEnvelope })
    ]
  );

  await client.query(
    `UPDATE agent_outbox
     SET run_id = $3,
         updated_at = now()
     WHERE tenant_id = $1
       AND id = $2
       AND run_id IS NULL`,
    [input.tenantId, input.outboxEventId, run.id]
  );

  await appendAgentRunEvent({
    client,
    tenantId: input.tenantId,
    runId: run.id,
    eventType: "agent.run.queued",
    status: "queued",
    summary: `Queued ${input.eventType}`,
    eventData: {
      outboxEventId: input.outboxEventId,
      eventType: input.eventType,
      laneKey: run.lane_key,
      commandEnvelope
    }
  });

  return run;
}

export async function markAgentRunRunning({
  tenantId,
  runId,
  attemptCount
}: {
  tenantId: string;
  runId: string;
  attemptCount: number;
}) {
  const result = await db.query<AgentRunReservationRow>(
    `WITH target AS MATERIALIZED (
       SELECT id, tenant_id, lane_key
       FROM agent_runs
       WHERE tenant_id = $1
         AND id = $2
     ),
     lane_lock AS MATERIALIZED (
       SELECT pg_advisory_xact_lock(
                hashtext(target.tenant_id::text),
                hashtext(target.lane_key)
              )
       FROM target
     ),
     blocker AS MATERIALIZED (
       SELECT other.id
       FROM agent_runs other, target, lane_lock
       WHERE other.tenant_id = target.tenant_id
         AND other.lane_key = target.lane_key
         AND other.id <> target.id
         AND other.status IN ('running', 'waiting_approval')
       ORDER BY other.updated_at ASC, other.created_at ASC
       LIMIT 1
     ),
     updated AS (
       UPDATE agent_runs run
       SET status = 'running',
           started_at = COALESCE(started_at, now()),
           failure_reason = NULL,
           updated_at = now()
       FROM target, lane_lock
       WHERE run.tenant_id = target.tenant_id
         AND run.id = target.id
         AND NOT EXISTS (SELECT 1 FROM blocker)
       RETURNING run.id, run.lane_key
     )
     SELECT true AS reserved, id, lane_key, NULL::uuid AS blocked_by_run_id
     FROM updated
     UNION ALL
     SELECT false AS reserved, target.id, target.lane_key, blocker.id AS blocked_by_run_id
     FROM target
     JOIN blocker ON true
     WHERE NOT EXISTS (SELECT 1 FROM updated)`,
    [tenantId, runId]
  );
  const reservation = result.rows[0] ?? null;
  if (!reservation?.reserved) {
    if (reservation?.blocked_by_run_id) {
      await appendAgentRunControlPlaneCommand({
        tenantId,
        runId,
        command: "agent.wait",
        eventType: "agent.run.lane_wait",
        status: "queued",
        summary: "Agent run lane is busy; queued behind active run",
        commandData: {
          waitReason: "lane_busy",
          metadata: {
            attemptCount,
            blockedByRunId: reservation.blocked_by_run_id,
            laneKey: reservation.lane_key
          }
        }
      });
    }
    return false;
  }
  await appendAgentRunEvent({
    tenantId,
    runId,
    eventType: "agent.run.running",
    status: "running",
    summary: "Agent run delivery started",
    eventData: { attemptCount }
  });
  return true;
}

export async function markAgentRunCompleted({
  tenantId,
  runId
}: {
  tenantId: string;
  runId: string;
}) {
  await db.query(
    `UPDATE agent_runs
     SET status = 'completed',
         completed_at = now(),
         failure_reason = NULL,
         updated_at = now()
     WHERE tenant_id = $1
       AND id = $2`,
    [tenantId, runId]
  );
  await appendAgentRunControlPlaneCommand({
    tenantId,
    runId,
    command: "agent.run.completed",
    eventType: "agent.run.completed",
    status: "completed",
    summary: "Agent run delivery completed",
    commandData: { completionStatus: "completed" }
  });
}

export async function markAgentRunFailed({
  tenantId,
  runId,
  errorMessage,
  terminal,
  attemptCount
}: {
  tenantId: string;
  runId: string;
  errorMessage: string;
  terminal: boolean;
  attemptCount: number;
}) {
  const status: AgentRunStatus = terminal ? "failed" : "queued";
  await db.query(
    `UPDATE agent_runs
     SET status = $3,
         failed_at = CASE WHEN $4::boolean THEN now() ELSE failed_at END,
         queued_at = CASE WHEN $4::boolean THEN queued_at ELSE now() END,
         failure_reason = $5,
         updated_at = now()
     WHERE tenant_id = $1
       AND id = $2`,
    [tenantId, runId, status, terminal, errorMessage.slice(0, 500)]
  );
  await appendAgentRunEvent({
    tenantId,
    runId,
    eventType: terminal ? "agent.run.failed" : "agent.run.retry_queued",
    status,
    summary: terminal ? "Agent run delivery failed" : "Agent run delivery failed; retry queued",
    eventData: {
      attemptCount,
      terminal,
      errorMessage: errorMessage.slice(0, 500)
    }
  });
}

export async function cancelAgentRun({
  tenantId,
  integrationId,
  runId,
  actor,
  reason
}: {
  tenantId: string;
  integrationId?: string | null;
  runId: string;
  actor?: DexterCommandEnvelope["actor"];
  reason?: string | null;
}): Promise<AgentRunCancellationResult> {
  const normalizedReason = normalizeCancelReason(reason);
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const targetResult = await client.query<{
      id: string;
      status: AgentRunStatus;
    }>(
      `SELECT id, status
       FROM agent_runs
       WHERE tenant_id = $1
         AND id = $2
         AND ($3::uuid IS NULL OR integration_id = $3::uuid)
       FOR UPDATE`,
      [tenantId, runId, integrationId ?? null]
    );
    const target = targetResult.rows[0] ?? null;
    if (!target) {
      await client.query("ROLLBACK");
      return {
        cancelled: false,
        reason: "not_found",
        runId,
        cancelledSteps: 0,
        cancelledToolCalls: 0,
        cancelledOutboxEvents: 0
      };
    }

    if (!["created", "queued", "running", "waiting_approval"].includes(target.status)) {
      await client.query("ROLLBACK");
      return {
        cancelled: false,
        reason: "not_cancellable",
        runId,
        previousStatus: target.status,
        cancelledSteps: 0,
        cancelledToolCalls: 0,
        cancelledOutboxEvents: 0
      };
    }

    await client.query(
      `UPDATE agent_runs
       SET status = 'cancelled',
           cancelled_at = now(),
           failure_reason = $3,
           updated_at = now()
       WHERE tenant_id = $1
         AND id = $2
         AND status IN ('created', 'queued', 'running', 'waiting_approval')`,
      [tenantId, runId, normalizedReason]
    );

    const stepResult = await client.query<{ cancelled_steps: number | string }>(
      `WITH updated AS (
         UPDATE agent_run_steps
         SET status = 'cancelled',
             completed_at = COALESCE(completed_at, now()),
             updated_at = now(),
             metadata = metadata || $3::jsonb
         WHERE tenant_id = $1
           AND run_id = $2
           AND status IN ('created', 'running', 'waiting_approval')
         RETURNING id
       )
       SELECT COUNT(*)::int AS cancelled_steps
       FROM updated`,
      [tenantId, runId, JSON.stringify({ cancelledBy: "admin", cancellationReason: normalizedReason })]
    );

    const toolResult = await client.query<{ cancelled_tool_calls: number | string }>(
      `WITH updated AS (
         UPDATE agent_tool_calls
         SET status = 'cancelled',
             error_message = $3,
             updated_at = now()
         WHERE tenant_id = $1
           AND run_id = $2
           AND status IN ('requested', 'approved', 'running')
         RETURNING id
       )
       SELECT COUNT(*)::int AS cancelled_tool_calls
       FROM updated`,
      [tenantId, runId, normalizedReason]
    );

    const outboxResult = await client.query<{ cancelled_outbox_events: number | string }>(
      `WITH updated AS (
         UPDATE agent_outbox
         SET status = 'failed',
             last_error = $3,
             next_attempt_at = now(),
             updated_at = now()
         WHERE tenant_id = $1
           AND run_id = $2
           AND status IN ('pending', 'processing')
         RETURNING id
       )
       SELECT COUNT(*)::int AS cancelled_outbox_events
       FROM updated`,
      [tenantId, runId, normalizedReason]
    );

    await appendAgentRunCancelCommand({
      client,
      tenantId,
      runId,
      actor,
      reason: normalizedReason
    });

    await client.query("COMMIT");
    return {
      cancelled: true,
      reason: "cancelled",
      runId,
      previousStatus: target.status,
      cancelledSteps: toNumber(stepResult.rows[0]?.cancelled_steps),
      cancelledToolCalls: toNumber(toolResult.rows[0]?.cancelled_tool_calls),
      cancelledOutboxEvents: toNumber(outboxResult.rows[0]?.cancelled_outbox_events)
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function recoverStaleAgentRuns({
  tenantId,
  integrationId,
  runningStaleSeconds,
  approvalStaleSeconds,
  limit,
  maxOutboxAttempts = 5
}: {
  tenantId: string;
  integrationId?: string | null;
  runningStaleSeconds?: number | null;
  approvalStaleSeconds?: number | null;
  limit?: number | null;
  maxOutboxAttempts?: number;
}) {
  const normalizedRunningStaleSeconds = normalizePositiveInteger(
    runningStaleSeconds,
    DEFAULT_AGENT_RUN_STALE_SECONDS
  );
  const normalizedApprovalStaleSeconds = normalizePositiveInteger(
    approvalStaleSeconds,
    DEFAULT_AGENT_APPROVAL_STALE_SECONDS
  );
  const normalizedLimit = normalizeLimit(
    limit,
    DEFAULT_AGENT_RUN_RECOVERY_LIMIT,
    MAX_STALE_AGENT_RUN_RECOVERY_LIMIT
  );
  const normalizedMaxAttempts = normalizePositiveInteger(maxOutboxAttempts, 5);
  const failureReason = "Recovered stale Dexter run after active-state timeout.";
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<StaleAgentRunRecoveryRow>(
      `WITH candidates AS MATERIALIZED (
         SELECT r.id,
                r.tenant_id,
                r.integration_id,
                r.status AS previous_status,
                r.lane_key,
                r.trigger_outbox_id,
                o.status AS previous_outbox_status,
                COALESCE(o.attempt_count, 0) AS previous_attempt_count,
                CASE
                  WHEN r.status = 'running' THEN 'timed_out'
                  ELSE 'lost'
                END AS recovered_status,
                CASE
                  WHEN o.id IS NULL OR o.status IN ('delivered', 'failed') THEN 'none'
                  WHEN COALESCE(o.attempt_count, 0) + 1 >= $6::int THEN 'dead_lettered'
                  ELSE 'retry_queued'
                END AS outbox_recovery_action
         FROM agent_runs r
         LEFT JOIN agent_outbox o
           ON o.tenant_id = r.tenant_id
          AND o.id = r.trigger_outbox_id
         WHERE r.tenant_id = $1
           AND ($2::uuid IS NULL OR r.integration_id = $2::uuid)
           AND r.status IN ('running', 'waiting_approval')
           AND (
             (r.status = 'running' AND r.updated_at <= now() - make_interval(secs => $3::int))
             OR (
               r.status = 'waiting_approval'
               AND r.updated_at <= now() - make_interval(secs => $4::int)
             )
           )
         ORDER BY r.updated_at ASC, r.created_at ASC
         LIMIT $5
         FOR UPDATE OF r SKIP LOCKED
       ),
       updated_runs AS (
         UPDATE agent_runs r
         SET status = candidates.recovered_status,
             timed_out_at = CASE
               WHEN candidates.recovered_status = 'timed_out' THEN now()
               ELSE r.timed_out_at
             END,
             lost_at = CASE
               WHEN candidates.recovered_status = 'lost' THEN now()
               ELSE r.lost_at
             END,
             failure_reason = $7,
             updated_at = now()
         FROM candidates
         WHERE r.tenant_id = candidates.tenant_id
           AND r.id = candidates.id
         RETURNING r.id,
                   r.tenant_id,
                   r.integration_id,
                   candidates.previous_status,
                   r.status AS recovered_status,
                   r.lane_key,
                   r.trigger_outbox_id,
                   candidates.previous_outbox_status,
                   candidates.previous_attempt_count,
                   candidates.outbox_recovery_action
       ),
       updated_outbox AS (
         UPDATE agent_outbox o
         SET status = CASE
               WHEN candidates.outbox_recovery_action = 'retry_queued' THEN 'pending'
               WHEN candidates.outbox_recovery_action = 'dead_lettered' THEN 'failed'
               ELSE o.status
             END,
             attempt_count = CASE
               WHEN candidates.outbox_recovery_action IN ('retry_queued', 'dead_lettered')
                 THEN candidates.previous_attempt_count + 1
               ELSE o.attempt_count
             END,
             last_error = CASE
               WHEN candidates.outbox_recovery_action IN ('retry_queued', 'dead_lettered')
                 THEN $7
               ELSE o.last_error
             END,
             next_attempt_at = CASE
               WHEN candidates.outbox_recovery_action = 'retry_queued' THEN now()
               ELSE o.next_attempt_at
             END,
             run_id = CASE
               WHEN candidates.outbox_recovery_action = 'retry_queued' THEN NULL
               ELSE o.run_id
             END,
             updated_at = CASE
               WHEN candidates.outbox_recovery_action IN ('retry_queued', 'dead_lettered') THEN now()
               ELSE o.updated_at
             END
         FROM candidates
         WHERE o.tenant_id = candidates.tenant_id
           AND o.id = candidates.trigger_outbox_id
           AND candidates.outbox_recovery_action <> 'none'
         RETURNING o.id,
                   o.status AS recovered_outbox_status,
                   o.attempt_count AS recovered_attempt_count
       )
       SELECT updated_runs.id,
              updated_runs.tenant_id,
              updated_runs.integration_id,
              updated_runs.previous_status,
              updated_runs.recovered_status,
              updated_runs.lane_key,
              updated_runs.trigger_outbox_id,
              updated_runs.previous_outbox_status,
              updated_outbox.recovered_outbox_status,
              updated_runs.previous_attempt_count,
              updated_outbox.recovered_attempt_count,
              updated_runs.outbox_recovery_action
       FROM updated_runs
       LEFT JOIN updated_outbox
         ON updated_outbox.id = updated_runs.trigger_outbox_id`,
      [
        tenantId,
        integrationId ?? null,
        normalizedRunningStaleSeconds,
        normalizedApprovalStaleSeconds,
        normalizedLimit,
        normalizedMaxAttempts,
        failureReason
      ]
    );

    for (const row of result.rows) {
      const eventData = {
        previousStatus: row.previous_status,
        recoveredStatus: row.recovered_status,
        laneKey: row.lane_key,
        outboxEventId: row.trigger_outbox_id,
        previousOutboxStatus: row.previous_outbox_status,
        recoveredOutboxStatus: row.recovered_outbox_status,
        previousAttemptCount: toNumber(row.previous_attempt_count),
        recoveredAttemptCount: toNumber(row.recovered_attempt_count),
        outboxRecoveryAction: row.outbox_recovery_action,
        runningStaleSeconds: normalizedRunningStaleSeconds,
        approvalStaleSeconds: normalizedApprovalStaleSeconds
      };

      if (row.recovered_status === "timed_out") {
        await appendAgentRunControlPlaneCommand({
          client,
          tenantId: row.tenant_id,
          runId: row.id,
          command: "agent.run.completed",
          eventType: "agent.run.timed_out",
          status: "timed_out",
          summary: "Agent run timed out and was recovered",
          commandData: {
            completionStatus: "timed_out",
            reason: failureReason,
            metadata: eventData
          }
        });
      } else {
        await appendAgentRunEvent({
          client,
          tenantId: row.tenant_id,
          runId: row.id,
          eventType: "agent.run.lost",
          status: "lost",
          summary: "Agent run marked lost after stale approval wait",
          eventData
        });
      }
    }

    await client.query("COMMIT");
    const retryQueued = result.rows.filter((row) => row.outbox_recovery_action === "retry_queued").length;
    const deadLettered = result.rows.filter((row) => row.outbox_recovery_action === "dead_lettered").length;
    const timedOut = result.rows.filter((row) => row.recovered_status === "timed_out").length;
    const lost = result.rows.filter((row) => row.recovered_status === "lost").length;
    return {
      recovered: result.rows.length,
      retryQueued,
      deadLettered,
      timedOut,
      lost,
      runningStaleSeconds: normalizedRunningStaleSeconds,
      approvalStaleSeconds: normalizedApprovalStaleSeconds,
      limit: normalizedLimit,
      runs: result.rows
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function listRecentAgentRuns({
  tenantId,
  integrationId,
  statuses,
  limit = 25
}: {
  tenantId: string;
  integrationId?: string | null;
  statuses?: AgentRunStatus[] | null;
  limit?: number;
}) {
  const normalizedLimit = Math.min(Math.max(limit, 1), 100);
  const normalizedStatuses = Array.from(
    new Set((statuses ?? []).filter((status): status is AgentRunStatus => AGENT_RUN_STATUSES.includes(status)))
  );
  const result = await db.query<AgentRunListRow>(
    `SELECT id, tenant_id, integration_id, run_type, status, lane_key,
            source_channel, resource_type, resource_id, trigger_event_type,
            trigger_outbox_id, idempotency_key, rollout_mode, provider_mode,
            failure_reason, created_at, queued_at, started_at, completed_at,
            failed_at, updated_at
     FROM agent_runs
     WHERE tenant_id = $1
       AND ($2::uuid IS NULL OR integration_id = $2::uuid)
       AND (cardinality($4::text[]) = 0 OR status = ANY($4::text[]))
     ORDER BY updated_at DESC
     LIMIT $3`,
    [tenantId, integrationId ?? null, normalizedLimit, normalizedStatuses]
  );
  return result.rows;
}
