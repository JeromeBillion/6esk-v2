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

type Queryable = Pick<typeof db, "query">;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

function queryable(client?: Queryable) {
  return client ?? db;
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
  await db.query(
    `UPDATE agent_runs
     SET status = 'running',
         started_at = COALESCE(started_at, now()),
         failure_reason = NULL,
         updated_at = now()
     WHERE tenant_id = $1
       AND id = $2`,
    [tenantId, runId]
  );
  await appendAgentRunEvent({
    tenantId,
    runId,
    eventType: "agent.run.running",
    status: "running",
    summary: "Agent run delivery started",
    eventData: { attemptCount }
  });
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

export async function listRecentAgentRuns({
  tenantId,
  integrationId,
  limit = 25
}: {
  tenantId: string;
  integrationId?: string | null;
  limit?: number;
}) {
  const normalizedLimit = Math.min(Math.max(limit, 1), 100);
  const result = await db.query(
    `SELECT id, tenant_id, integration_id, run_type, status, lane_key,
            source_channel, resource_type, resource_id, trigger_event_type,
            trigger_outbox_id, idempotency_key, rollout_mode, provider_mode,
            failure_reason, created_at, queued_at, started_at, completed_at,
            failed_at, updated_at
     FROM agent_runs
     WHERE tenant_id = $1
       AND ($2::uuid IS NULL OR integration_id = $2::uuid)
     ORDER BY updated_at DESC
     LIMIT $3`,
    [tenantId, integrationId ?? null, normalizedLimit]
  );
  return result.rows;
}
