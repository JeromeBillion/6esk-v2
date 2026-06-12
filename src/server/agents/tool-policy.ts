import {
  evaluatePromptSafety,
  promptSafetyTelemetry,
  type PromptSafetyDecision
} from "@/server/ai/prompt-safety";
import { db } from "@/server/db";

export type AgentToolClass =
  | "review_request"
  | "draft"
  | "reversible_write"
  | "external_send"
  | "irreversible_write";

export type AgentToolPolicyDecision = "allow" | "needs_review" | "read_only" | "block";

export type AgentToolPolicyMode = "dry_run" | "draft_only" | "hybrid_review" | "full_auto";

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

export function normalizeAgentToolPolicyMode(mode?: string | null): AgentToolPolicyMode {
  const normalized = mode?.trim().toLowerCase();
  if (normalized === "dry_run") return "dry_run";
  if (normalized === "draft_only") return "draft_only";
  if (normalized === "full_auto" || normalized === "auto" || normalized === "auto_send") {
    return "full_auto";
  }
  if (normalized === "limited_auto") return "hybrid_review";
  return "hybrid_review";
}

function serializeToolContent(value: unknown) {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value ?? {});
  } catch {
    return "[unserializable agent tool request]";
  }
}

function reasonCodesFor(decision: PromptSafetyDecision) {
  return decision.flags.map((flag) => flag.code);
}

function decideAgentToolPolicy(input: {
  toolClass: AgentToolClass;
  policyMode: AgentToolPolicyMode;
  promptSafety: PromptSafetyDecision;
}): AgentToolPolicyDecision {
  if (input.toolClass === "review_request") {
    return "allow";
  }

  if (input.promptSafety.decision === "deny" || input.promptSafety.riskLevel === "high") {
    return "block";
  }

  if (input.promptSafety.decision === "downgrade" || input.promptSafety.riskLevel === "medium") {
    return input.policyMode === "hybrid_review" ? "needs_review" : "read_only";
  }

  return "allow";
}

function detailForDecision(decision: AgentToolPolicyDecision) {
  if (decision === "needs_review") {
    return "Prompt-safety guard downgraded this action; hybrid review is required before side effects.";
  }
  if (decision === "read_only") {
    return "Prompt-safety guard downgraded this action to read-only/no-tool mode.";
  }
  if (decision === "block") {
    return "Prompt-safety guard blocked unsafe instruction-control language.";
  }
  return null;
}

export async function recordAgentToolPolicyDecision(input: {
  tenantId: string;
  integrationId?: string | null;
  runId?: string | null;
  policyMode?: string | null;
  rolloutMode?: string | null;
  actionType: string;
  toolClass: AgentToolClass;
  decision: AgentToolPolicyDecision;
  reasonCodes: string[];
  resource?: Record<string, unknown> | null;
  promptSafety: PromptSafetyDecision;
  metadata?: Record<string, unknown> | null;
}) {
  await db.query(
    `INSERT INTO agent_tool_policy_decisions (
       tenant_id,
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
       metadata
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11::jsonb, $12::jsonb)`,
    [
      input.tenantId,
      input.integrationId ?? null,
      input.runId ?? null,
      normalizeAgentToolPolicyMode(input.policyMode),
      input.rolloutMode ?? null,
      input.actionType,
      input.toolClass,
      input.decision,
      JSON.stringify(input.reasonCodes),
      JSON.stringify(input.resource ?? {}),
      JSON.stringify(promptSafetyTelemetry(input.promptSafety)),
      JSON.stringify(input.metadata ?? {})
    ]
  );
}

export async function evaluateAgentToolPolicy(input: {
  tenantId: string;
  integrationId?: string | null;
  runId?: string | null;
  policyMode?: string | null;
  rolloutMode?: string | null;
  actionType: string;
  resource?: Record<string, unknown> | null;
  content?: unknown;
  metadata?: Record<string, unknown> | null;
}) {
  const toolClass = classifyAgentTool(input.actionType);
  const policyMode = normalizeAgentToolPolicyMode(input.policyMode);
  const promptSafety = evaluatePromptSafety({
    text: serializeToolContent(input.content),
    source: "agent_tool_request"
  });
  const decision = decideAgentToolPolicy({ toolClass, policyMode, promptSafety });
  const reasonCodes = reasonCodesFor(promptSafety);

  await recordAgentToolPolicyDecision({
    tenantId: input.tenantId,
    integrationId: input.integrationId,
    runId: input.runId,
    policyMode,
    rolloutMode: input.rolloutMode,
    actionType: input.actionType,
    toolClass,
    decision,
    reasonCodes,
    resource: input.resource,
    promptSafety,
    metadata: {
      ...(input.metadata ?? {}),
      guardVersion: promptSafety.guardVersion,
      promptSafetyDecision: promptSafety.decision,
      promptSafetyRiskLevel: promptSafety.riskLevel
    }
  });

  return {
    allowed: decision === "allow",
    decision,
    toolClass,
    reasonCodes,
    detail: detailForDecision(decision),
    promptSafety
  };
}
