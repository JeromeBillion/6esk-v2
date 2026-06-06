import {
  inspectAiInput,
  isAiGuardUnsafe,
  recordAiGuardEvent,
  serializeAiGuardValue
} from "@/server/ai/guard";
import type { AgentCustomerContext } from "@/server/agents/customer-context";

export type AgentOutputValidationDecision = "allow" | "block";

function detailForDecision(reasonCodes: string[]) {
  return `AI output validator blocked unsafe generated content: ${reasonCodes.join(", ")}.`;
}

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

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function collectAllowedSourceIds(context: AgentCustomerContext) {
  return new Set(
    unique([
      context.active_ticket_id ?? "",
      context.active_thread_id ?? "",
      context.current_customer_id ?? "",
      ...context.allowed_source_ids.ticket_ids,
      ...context.allowed_source_ids.customer_ids,
      ...context.allowed_source_ids.message_ids,
      ...context.allowed_source_ids.mailbox_ids,
      ...context.allowed_source_ids.thread_ids,
      ...context.same_customer_history_ticket_ids
    ])
  );
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

function evaluateCustomerPrivacy(input: {
  actionType: string;
  text: string;
  customerContext?: AgentCustomerContext | null;
  sourceMetadata?: Record<string, unknown> | null;
}) {
  if (!CUSTOMER_REPLY_ACTIONS.has(input.actionType) || !input.customerContext) {
    return [];
  }

  const reasonCodes: string[] = [];
  const context = input.customerContext;
  const allowedSourceIds = collectAllowedSourceIds(context);
  const claimedSourceIds = Array.from(collectClaimedSourceIds(input.sourceMetadata));
  const uuidMentions = extractUuidMentions(input.text);
  const disallowedSourceIds = unique([...claimedSourceIds, ...uuidMentions]).filter(
    (id) => !allowedSourceIds.has(id) && !allowedSourceIds.has(id.toLowerCase())
  );

  if (disallowedSourceIds.length > 0) {
    reasonCodes.push("customer_source_id_out_of_scope");
  }

  if (
    context.ambiguity_state !== "resolved" &&
    CUSTOMER_HISTORY_CLAIM_PATTERN.test(input.text)
  ) {
    reasonCodes.push(`customer_context_${context.ambiguity_state}`);
  }

  if (context.profile_pii_policy === "minimize" && containsProfilePii(input.text)) {
    reasonCodes.push("profile_pii_overexposure");
  }

  if (CROSS_CUSTOMER_SCOPE_PATTERNS.some((pattern) => pattern.test(input.text))) {
    reasonCodes.push("cross_customer_scope_expansion");
  }

  return unique(reasonCodes);
}

export async function validateAgentOutput(input: {
  tenantKey: string;
  workspaceKey?: string | null;
  runId?: string | null;
  integrationId?: string | null;
  actionType: string;
  sourceId?: string | null;
  content: unknown;
  customerContext?: AgentCustomerContext | null;
  sourceMetadata?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
}) {
  const serializedContent = serializeAiGuardValue(input.content);
  const inspection = inspectAiInput({
    text: serializedContent,
    policyMode: "full_auto"
  });
  const privacyReasonCodes = evaluateCustomerPrivacy({
    actionType: input.actionType,
    text: serializedContent,
    customerContext: input.customerContext,
    sourceMetadata: input.sourceMetadata
  });

  if (!isAiGuardUnsafe(inspection) && privacyReasonCodes.length === 0) {
    return {
      allowed: true,
      decision: "allow" as AgentOutputValidationDecision,
      reasonCodes: inspection.reasonCodes,
      detail: null,
      inspection
    };
  }

  const blockedInspection = {
    ...inspection,
    severity: "malicious" as const,
    decision: "block" as const,
    reasonCodes: unique([...inspection.reasonCodes, ...privacyReasonCodes])
  };

  await recordAiGuardEvent({
    tenantKey: input.tenantKey,
    workspaceKey: input.workspaceKey,
    runId: input.runId,
    integrationId: input.integrationId,
    sourceKind: "agent_output",
    sourceId: input.sourceId,
    subject: input.actionType,
    inspection: blockedInspection,
    metadata: {
      ...(input.metadata ?? {}),
      customerContextState: input.customerContext?.ambiguity_state ?? null,
      customerContextTicketId: input.customerContext?.active_ticket_id ?? null,
      customerContextCustomerId: input.customerContext?.current_customer_id ?? null
    }
  });

  return {
    allowed: false,
    decision: "block" as AgentOutputValidationDecision,
    reasonCodes: blockedInspection.reasonCodes,
    detail: detailForDecision(blockedInspection.reasonCodes),
    inspection: blockedInspection
  };
}
