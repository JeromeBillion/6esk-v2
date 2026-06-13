import {
  evaluatePromptSafety,
  promptSafetyTelemetry,
  type PromptSafetyDecision,
  type PromptSafetyFlag,
  type PromptSafetyRiskLevel
} from "@/server/ai/prompt-safety";
import { recordAuditLog } from "@/server/audit";

export type AgentOutputValidationDecision = "allow" | "block";

type AgentOutputValidationFlag = PromptSafetyFlag & {
  source: "prompt_safety" | "output_validator" | "customer_context";
};

type AgentOutputValidationResult = {
  allowed: boolean;
  decision: AgentOutputValidationDecision;
  riskLevel: PromptSafetyRiskLevel;
  reasonCodes: string[];
  detail: string | null;
  promptSafety: ReturnType<typeof promptSafetyTelemetry>;
  outputFlags: AgentOutputValidationFlag[];
};

export type AgentOutputCustomerContextState = "resolved" | "unresolved" | "ambiguous" | "conflicted";

export type AgentOutputCustomerContext = {
  schemaVersion?: "agent-customer-output-context.v1";
  activeTicketId?: string | null;
  activeThreadId?: string | null;
  currentCustomerId?: string | null;
  ambiguityState?: AgentOutputCustomerContextState;
  allowedSourceIds?: {
    ticketIds?: string[];
    customerIds?: string[];
    messageIds?: string[];
    mailboxIds?: string[];
    threadIds?: string[];
  };
  sameCustomerHistoryTicketIds?: string[];
  customerVisibleProfileFields?: string[];
  profilePiiPolicy?: "minimize" | "allow";
  disallowedScopeExpansion?: string[];
};

const OUTPUT_SPECIFIC_RULES: Array<{
  code: string;
  severity: PromptSafetyFlag["severity"];
  pattern: RegExp;
}> = [
  {
    code: "internal_policy_reference",
    severity: "high",
    pattern:
      /\b(system prompt|developer message|hidden policy|internal policy|tenant secret|provider token|api key|secret key)\b/i
  },
  {
    code: "cross_customer_disclosure",
    severity: "high",
    pattern:
      /\b(other|another|different|next)\b.{0,80}\b(customer|client|tenant|account|workspace)\b.{0,120}\b(ticket|query|conversation|history|phone|email|profile|document|record)\b/i
  },
  {
    code: "audit_suppression_output",
    severity: "medium",
    pattern: /\b(do not|don't|never|avoid)\b.{0,80}\b(log|audit|record|cite|show source|mention source)\b/i
  }
];

const CUSTOMER_REPLY_ACTIONS = new Set(["draft_reply", "send_reply"]);
const UUID_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PHONE_PATTERN = /\+?\d[\d\s().-]{7,}\d/g;
const CUSTOMER_HISTORY_CLAIM_PATTERN =
  /\b(previous|prior|past|history|account|profile|ticket|case|conversation|query|order|trade|billing|address|phone|email)\b/i;
const CROSS_CUSTOMER_SCOPE_PATTERNS = [
  /\b(other|another|different)\s+(customer|client|tenant|workspace)\b/i,
  /\ball\s+(customers|clients|tenants|workspaces)\b/i,
  /\bmailbox[-\s]?wide\b/i,
  /\banalytics[-\s]?wide\b/i,
  /\bcross[-\s]?(tenant|customer|workspace)\b/i,
  /\braw\s+(database|table|records?)\b/i
] as const;
const SOURCE_ID_KEY_PATTERN =
  /(^|_)(source|sources|citation|citations|reference|references|evidence|history)(_|$)|(^|_)(ticket|customer|message|mailbox|thread)(_|$)|(?:source|ticket|customer|message|mailbox|thread).*(?:Id|Ids)$/i;

function serializeOutputContent(value: unknown) {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value ?? {});
  } catch {
    return "[unserializable agent output]";
  }
}

function uniqueFlags(flags: AgentOutputValidationFlag[]) {
  const seen = new Set<string>();
  return flags.filter((flag) => {
    const key = `${flag.source}:${flag.code}:${flag.severity}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function addAllowedSourceId(ids: Set<string>, value: string | null | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) return;
  ids.add(trimmed);
  ids.add(trimmed.toLowerCase());
}

function collectAllowedSourceIds(context: AgentOutputCustomerContext) {
  const ids = new Set<string>();
  addAllowedSourceId(ids, context.activeTicketId);
  addAllowedSourceId(ids, context.activeThreadId);
  addAllowedSourceId(ids, context.currentCustomerId);
  for (const value of context.allowedSourceIds?.ticketIds ?? []) addAllowedSourceId(ids, value);
  for (const value of context.allowedSourceIds?.customerIds ?? []) addAllowedSourceId(ids, value);
  for (const value of context.allowedSourceIds?.messageIds ?? []) addAllowedSourceId(ids, value);
  for (const value of context.allowedSourceIds?.mailboxIds ?? []) addAllowedSourceId(ids, value);
  for (const value of context.allowedSourceIds?.threadIds ?? []) addAllowedSourceId(ids, value);
  for (const value of context.sameCustomerHistoryTicketIds ?? []) addAllowedSourceId(ids, value);
  return ids;
}

function asRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function collectClaimedSourceIds(value: unknown, ids = new Set<string>(), keyHint = false) {
  if (typeof value === "string") {
    if (keyHint && value.trim()) {
      ids.add(value.trim());
    }
    return ids;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectClaimedSourceIds(item, ids, keyHint);
    }
    return ids;
  }
  const record = asRecord(value);
  if (!record) {
    return ids;
  }
  for (const [key, nested] of Object.entries(record)) {
    collectClaimedSourceIds(nested, ids, keyHint || SOURCE_ID_KEY_PATTERN.test(key));
  }
  return ids;
}

function extractUuidMentions(text: string) {
  const matches = text.match(UUID_PATTERN) ?? [];
  UUID_PATTERN.lastIndex = 0;
  return matches.map((value) => value.toLowerCase());
}

function containsProfilePii(text: string) {
  const hasEmail = EMAIL_PATTERN.test(text);
  EMAIL_PATTERN.lastIndex = 0;
  const hasPhone = PHONE_PATTERN.test(text);
  PHONE_PATTERN.lastIndex = 0;
  return hasEmail || hasPhone;
}

function customerPrivacyFlag(code: string, severity: PromptSafetyFlag["severity"]) {
  return {
    code,
    severity,
    source: "customer_context" as const
  };
}

function evaluateCustomerPrivacy(input: {
  actionType?: string | null;
  text: string;
  customerContext?: AgentOutputCustomerContext | null;
  sourceMetadata?: Record<string, unknown> | null;
}) {
  if (!input.actionType || !CUSTOMER_REPLY_ACTIONS.has(input.actionType) || !input.customerContext) {
    return [];
  }

  const flags: AgentOutputValidationFlag[] = [];
  const context = input.customerContext;
  const allowedSourceIds = collectAllowedSourceIds(context);
  const claimedSourceIds = Array.from(collectClaimedSourceIds(input.sourceMetadata));
  const uuidMentions = extractUuidMentions(input.text);
  const disallowedSourceIds = unique([...claimedSourceIds, ...uuidMentions]).filter((id) => {
    const normalized = id.toLowerCase();
    return !allowedSourceIds.has(id) && !allowedSourceIds.has(normalized);
  });

  if (disallowedSourceIds.length > 0) {
    flags.push(customerPrivacyFlag("customer_source_id_out_of_scope", "high"));
  }

  const ambiguityState = context.ambiguityState ?? "ambiguous";
  if (ambiguityState !== "resolved" && CUSTOMER_HISTORY_CLAIM_PATTERN.test(input.text)) {
    flags.push(customerPrivacyFlag(`customer_context_${ambiguityState}`, "high"));
  }

  if ((context.profilePiiPolicy ?? "minimize") === "minimize" && containsProfilePii(input.text)) {
    flags.push(customerPrivacyFlag("profile_pii_overexposure", "high"));
  }

  if (CROSS_CUSTOMER_SCOPE_PATTERNS.some((pattern) => pattern.test(input.text))) {
    flags.push(customerPrivacyFlag("cross_customer_scope_expansion", "high"));
  }

  return uniqueFlags(flags);
}

function summarizeCustomerContext(context?: AgentOutputCustomerContext | null) {
  if (!context) return null;
  return {
    schemaVersion: context.schemaVersion ?? "agent-customer-output-context.v1",
    ambiguityState: context.ambiguityState ?? "ambiguous",
    hasActiveTicketId: Boolean(context.activeTicketId),
    hasCurrentCustomerId: Boolean(context.currentCustomerId),
    profilePiiPolicy: context.profilePiiPolicy ?? "minimize",
    allowedSourceCounts: {
      ticketIds: context.allowedSourceIds?.ticketIds?.length ?? 0,
      customerIds: context.allowedSourceIds?.customerIds?.length ?? 0,
      messageIds: context.allowedSourceIds?.messageIds?.length ?? 0,
      mailboxIds: context.allowedSourceIds?.mailboxIds?.length ?? 0,
      threadIds: context.allowedSourceIds?.threadIds?.length ?? 0,
      sameCustomerHistoryTicketIds: context.sameCustomerHistoryTicketIds?.length ?? 0
    }
  };
}

function highestRisk(flags: AgentOutputValidationFlag[], promptSafety: PromptSafetyDecision) {
  if (promptSafety.riskLevel === "high" || flags.some((flag) => flag.severity === "high")) {
    return "high" as const;
  }
  if (promptSafety.riskLevel === "medium" || flags.some((flag) => flag.severity === "medium")) {
    return "medium" as const;
  }
  if (promptSafety.riskLevel === "low" || flags.some((flag) => flag.severity === "low")) {
    return "low" as const;
  }
  return "none" as const;
}

function reasonCodesFor(flags: AgentOutputValidationFlag[], promptSafety: PromptSafetyDecision) {
  return Array.from(
    new Set([
      ...promptSafety.flags.map((flag) => flag.code),
      ...flags.map((flag) => flag.code)
    ])
  );
}

function outputSpecificFlags(text: string) {
  return uniqueFlags(
    OUTPUT_SPECIFIC_RULES.filter((rule) => {
      rule.pattern.lastIndex = 0;
      return rule.pattern.test(text);
    }).map((rule) => ({
      code: rule.code,
      severity: rule.severity,
      source: "output_validator" as const
    }))
  );
}

function detailForDecision(reasonCodes: string[]) {
  return `AI output validator blocked unsafe generated content: ${reasonCodes.join(", ")}.`;
}

export function evaluateAgentOutputSafety(input: {
  content: unknown;
  source?: string;
  blockMediumRisk?: boolean;
  actionType?: string | null;
  customerContext?: AgentOutputCustomerContext | null;
  sourceMetadata?: Record<string, unknown> | null;
}): AgentOutputValidationResult {
  const serialized = serializeOutputContent(input.content);
  const promptSafety = evaluatePromptSafety({
    text: serialized,
    source: input.source ?? "agent_output"
  });
  const outputFlags = uniqueFlags([
    ...promptSafety.flags.map((flag) => ({
      ...flag,
      source: "prompt_safety" as const
    })),
    ...outputSpecificFlags(promptSafety.normalizedText),
    ...evaluateCustomerPrivacy({
      actionType: input.actionType,
      text: promptSafety.normalizedText,
      customerContext: input.customerContext,
      sourceMetadata: input.sourceMetadata
    })
  ]);
  const riskLevel = highestRisk(outputFlags, promptSafety);
  const blockMediumRisk = input.blockMediumRisk ?? true;
  const blocked =
    riskLevel === "high" ||
    promptSafety.decision === "deny" ||
    (blockMediumRisk && (riskLevel === "medium" || promptSafety.decision === "downgrade"));
  const reasonCodes = reasonCodesFor(outputFlags, promptSafety);

  return {
    allowed: !blocked,
    decision: blocked ? "block" : "allow",
    riskLevel,
    reasonCodes,
    detail: blocked ? detailForDecision(reasonCodes) : null,
    promptSafety: promptSafetyTelemetry(promptSafety),
    outputFlags
  };
}

export async function validateAgentOutput(input: {
  tenantId: string;
  integrationId?: string | null;
  runId?: string | null;
  actionType: string;
  resourceType?: string | null;
  resourceId?: string | null;
  content: unknown;
  metadata?: Record<string, unknown> | null;
  blockMediumRisk?: boolean;
  customerContext?: AgentOutputCustomerContext | null;
  sourceMetadata?: Record<string, unknown> | null;
}) {
  const validation = evaluateAgentOutputSafety({
    content: input.content,
    source: "agent_output",
    blockMediumRisk: input.blockMediumRisk,
    actionType: input.actionType,
    customerContext: input.customerContext,
    sourceMetadata: input.sourceMetadata
  });

  if (validation.allowed) {
    return validation;
  }

  await recordAuditLog({
    tenantId: input.tenantId,
    action: "ai_output_validation_blocked",
    entityType: input.resourceType ?? "agent_output",
    entityId: input.resourceId ?? null,
    data: {
      integrationId: input.integrationId ?? null,
      runId: input.runId ?? null,
      actionType: input.actionType,
      decision: validation.decision,
      riskLevel: validation.riskLevel,
      reasonCodes: validation.reasonCodes,
      promptSafety: validation.promptSafety,
      outputFlags: validation.outputFlags,
      metadataKeys: Object.keys(input.metadata ?? {}).sort().slice(0, 20),
      sourceMetadataKeys: Object.keys(input.sourceMetadata ?? {}).sort().slice(0, 20),
      customerContext: summarizeCustomerContext(input.customerContext)
    }
  });

  return validation;
}
