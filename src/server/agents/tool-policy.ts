import { normalizeAgentPolicyMode } from "@/server/agents/policy-modes";
import {
  inspectAiInput,
  isAiGuardUnsafe,
  recordAiGuardEvent,
  serializeAiGuardValue,
  type AiGuardInspection
} from "@/server/ai/guard";
import { db } from "@/server/db";

export type AgentToolClass =
  | "review_request"
  | "draft"
  | "reversible_write"
  | "external_send"
  | "irreversible_write";

export type AgentToolPolicyDecision = "allow" | "needs_review" | "read_only" | "block";

const ACTION_TOOL_CLASSES: Record<string, AgentToolClass> = {
  request_human_review: "review_request",
  draft_reply: "draft",
  set_tags: "reversible_write",
  set_priority: "reversible_write",
  assign_to: "reversible_write",
  propose_merge: "review_request",
  send_reply: "external_send",
  initiate_call: "external_send",
  link_tickets: "irreversible_write",
  merge_tickets: "irreversible_write",
  merge_customers: "irreversible_write"
};

export function classifyAgentTool(actionType: string): AgentToolClass {
  return ACTION_TOOL_CLASSES[actionType] ?? "reversible_write";
}

function policyDecisionForGuard(input: {
  actionType: string;
  toolClass: AgentToolClass;
  policyMode?: string | null;
  inspection: AiGuardInspection;
}): AgentToolPolicyDecision {
  if (!isAiGuardUnsafe(input.inspection)) {
    return "allow";
  }

  if (input.toolClass === "review_request") {
    return "allow";
  }

  if (input.inspection.severity === "malicious") {
    return "block";
  }

  const mode = normalizeAgentPolicyMode(input.policyMode);
  return mode === "hybrid_review" ? "needs_review" : "read_only";
}

function detailForDecision(decision: AgentToolPolicyDecision) {
  if (decision === "needs_review") {
    return "AI safety guard detected suspicious instruction-control language; hybrid review is required.";
  }
  if (decision === "read_only") {
    return "AI safety guard downgraded this full-auto action to no-tool/read-only mode.";
  }
  if (decision === "block") {
    return "AI safety guard blocked unsafe instruction-control language.";
  }
  return null;
}

export async function recordAiPolicyDecision(input: {
  tenantKey: string;
  workspaceKey?: string | null;
  runId?: string | null;
  integrationId?: string | null;
  policyMode?: string | null;
  toolName: string;
  toolClass: AgentToolClass;
  decision: AgentToolPolicyDecision;
  reasonCodes?: string[];
  resource?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
}) {
  await db.query(
    `INSERT INTO ai_policy_decisions (
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
       metadata
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      input.tenantKey,
      input.workspaceKey ?? "primary",
      input.runId ?? null,
      input.integrationId ?? null,
      normalizeAgentPolicyMode(input.policyMode),
      input.toolName,
      input.toolClass,
      input.decision,
      input.reasonCodes ?? [],
      input.resource ?? {},
      input.metadata ?? {}
    ]
  );
}

export async function evaluateAgentToolPolicy(input: {
  tenantKey: string;
  workspaceKey?: string | null;
  integrationId?: string | null;
  runId?: string | null;
  policyMode?: string | null;
  actionType: string;
  resource?: Record<string, unknown> | null;
  content?: unknown;
  metadata?: Record<string, unknown> | null;
}) {
  const toolClass = classifyAgentTool(input.actionType);
  const contentText = serializeAiGuardValue(input.content ?? {});
  const inspection = inspectAiInput({
    text: contentText,
    policyMode: normalizeAgentPolicyMode(input.policyMode)
  });
  const decision = policyDecisionForGuard({
    actionType: input.actionType,
    toolClass,
    policyMode: input.policyMode,
    inspection
  });

  if (isAiGuardUnsafe(inspection)) {
    await recordAiGuardEvent({
      tenantKey: input.tenantKey,
      workspaceKey: input.workspaceKey,
      runId: input.runId,
      integrationId: input.integrationId,
      sourceKind: "agent_action_request",
      sourceId: input.resource?.ticketId?.toString() ?? null,
      subject: input.actionType,
      inspection,
      metadata: {
        ...(input.metadata ?? {}),
        toolClass,
        policyMode: normalizeAgentPolicyMode(input.policyMode)
      }
    });
  }

  await recordAiPolicyDecision({
    tenantKey: input.tenantKey,
    workspaceKey: input.workspaceKey,
    runId: input.runId,
    integrationId: input.integrationId,
    policyMode: input.policyMode,
    toolName: input.actionType,
    toolClass,
    decision,
    reasonCodes: inspection.reasonCodes,
    resource: input.resource,
    metadata: {
      ...(input.metadata ?? {}),
      guardVersion: inspection.guardVersion,
      guardSeverity: inspection.severity
    }
  });

  return {
    allowed: decision === "allow",
    decision,
    toolClass,
    reasonCodes: inspection.reasonCodes,
    detail: detailForDecision(decision),
    inspection
  };
}
