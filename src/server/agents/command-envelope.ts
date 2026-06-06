import { randomUUID } from "crypto";
import { normalizeAgentPolicyMode, type CanonicalAgentPolicyMode } from "@/server/agents/policy-modes";
import type { AgentPromptSandbox } from "@/server/agents/prompt-sandbox";

export const AGENT_COMMAND_TYPES = [
  "agent.run.create",
  "agent.run.cancel",
  "agent.wait",
  "agent.tool.requested",
  "agent.tool.completed",
  "agent.approval.requested",
  "agent.run.completed"
] as const;

export type AgentCommandType = (typeof AGENT_COMMAND_TYPES)[number];

export type AgentCommandEnvelope = {
  schema_version: "agent-command.v1";
  command_id: string;
  command_type: AgentCommandType;
  issued_at: string;
  tenant_key: string;
  workspace_key: string;
  integration_id: string;
  run_id: string;
  lane_key: string;
  mode: CanonicalAgentPolicyMode;
  idempotency_key?: string | null;
  resource: Record<string, unknown>;
  payload: Record<string, unknown>;
  policy?: Record<string, unknown>;
  prompt_sandbox?: AgentPromptSandbox;
};

type BuildCommandEnvelopeInput = {
  commandType: AgentCommandType;
  tenantKey?: string | null;
  workspaceKey?: string | null;
  integrationId: string;
  runId?: string | null;
  laneKey: string;
  policyMode?: string | null;
  idempotencyKey?: string | null;
  resource?: Record<string, unknown> | null;
  payload?: Record<string, unknown> | null;
  policy?: Record<string, unknown> | null;
  promptSandbox?: AgentPromptSandbox | null;
};

export function buildAgentCommandEnvelope({
  commandType,
  tenantKey,
  workspaceKey,
  integrationId,
  runId,
  laneKey,
  policyMode,
  idempotencyKey,
  resource,
  payload,
  policy,
  promptSandbox
}: BuildCommandEnvelopeInput): AgentCommandEnvelope {
  return {
    schema_version: "agent-command.v1",
    command_id: randomUUID(),
    command_type: commandType,
    issued_at: new Date().toISOString(),
    tenant_key: tenantKey?.trim() || "primary",
    workspace_key: workspaceKey?.trim() || "primary",
    integration_id: integrationId,
    run_id: runId?.trim() || randomUUID(),
    lane_key: laneKey,
    mode: normalizeAgentPolicyMode(policyMode),
    idempotency_key: idempotencyKey?.trim() || null,
    resource: resource ?? {},
    payload: payload ?? {},
    policy: policy ?? undefined,
    prompt_sandbox: promptSandbox ?? undefined
  };
}

export function readEnvelopeRunId(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const runId = (value as Record<string, unknown>).run_id;
  return typeof runId === "string" && runId.trim() ? runId : null;
}

export function mapEventTypeToCommandType(eventType: string): AgentCommandType {
  if (eventType === "agent.run.cancel") return "agent.run.cancel";
  if (eventType === "agent.wait") return "agent.wait";
  if (eventType === "agent.tool.requested") return "agent.tool.requested";
  if (eventType === "agent.tool.completed") return "agent.tool.completed";
  if (eventType === "agent.approval.requested" || eventType.endsWith(".review.required")) {
    return "agent.approval.requested";
  }
  if (eventType === "agent.run.completed") return "agent.run.completed";
  return "agent.run.create";
}

export function buildLaneKey(input: {
  tenantKey?: string | null;
  eventType?: string | null;
  payload?: Record<string, unknown> | null;
}) {
  const tenantKey = input.tenantKey?.trim() || "primary";
  const resource = asRecord(input.payload?.resource);
  const ticketId = readString(resource?.ticket_id);
  if (ticketId) return `${tenantKey}:ticket:${ticketId}`;

  const messageId = readString(resource?.message_id);
  if (messageId) return `${tenantKey}:message:${messageId}`;

  const mailboxId = readString(resource?.mailbox_id);
  if (mailboxId) return `${tenantKey}:mailbox:${mailboxId}`;

  const conversationRef = readString(input.payload?.conversation_ref);
  if (conversationRef) return `${tenantKey}:conversation:${conversationRef}`;

  const eventId = readString(input.payload?.event_id);
  if (eventId) return `${tenantKey}:event:${eventId}`;

  return `${tenantKey}:event-type:${input.eventType ?? "agent"}`;
}

export function extractEnvelopeResource(payload: Record<string, unknown>) {
  const resource = asRecord(payload.resource);
  return resource ?? {};
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
