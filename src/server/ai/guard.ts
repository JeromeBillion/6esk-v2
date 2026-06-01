import { db } from "@/server/db";

export const AI_GUARD_VERSION = "ai-guard-rules.v1";

export type AiGuardSeverity = "clean" | "suspicious" | "malicious";
export type AiGuardDecision = "allow" | "review" | "read_only" | "block";
export type AiGuardSourceKind =
  | "knowledge_upload"
  | "knowledge_retrieval_query"
  | "knowledge_retrieval_result"
  | "agent_command_payload"
  | "agent_action_request"
  | "agent_output";

export type AiGuardInspection = {
  guardVersion: string;
  severity: AiGuardSeverity;
  decision: AiGuardDecision;
  reasonCodes: string[];
  sanitizedText: string;
  contentSample: string;
  originalLength: number;
  sanitizedLength: number;
};

type AiGuardPattern = {
  code: string;
  severity: Exclude<AiGuardSeverity, "clean">;
  pattern: RegExp;
};

const DEFAULT_MAX_GUARD_CHARS = 32_000;
const SAMPLE_LENGTH = 700;

const ZERO_WIDTH_PATTERN = /[\u200B-\u200D\u2060\uFEFF]/g;
const BIDI_CONTROL_PATTERN = /[\u202A-\u202E\u2066-\u2069]/g;
const CONTROL_PATTERN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const TOKEN_PATTERN =
  /\b(?:sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_]{12,}|xox[baprs]-[A-Za-z0-9-]{12,}|AIza[0-9A-Za-z_-]{12,})\b/g;
const PHONE_PATTERN = /\+?\d[\d\s().-]{7,}\d/g;

const PROMPT_INJECTION_PATTERNS: AiGuardPattern[] = [
  {
    code: "ignore_instructions",
    severity: "malicious",
    pattern:
      /\b(ignore|override|forget|disregard)\b.{0,100}\b(previous|prior|above|system|developer)\b.{0,60}\b(instruction|prompt|message|policy|rule)s?\b/i
  },
  {
    code: "reveal_prompts",
    severity: "malicious",
    pattern:
      /\b(reveal|print|show|dump|exfiltrate|leak|repeat)\b.{0,100}\b(system prompt|developer message|hidden instruction|secret|api key|token|policy)s?\b/i
  },
  {
    code: "prompt_leak_exact_text",
    severity: "malicious",
    pattern:
      /\b(copy|quote|provide|return|write)\b.{0,100}\b(exact|verbatim|full|raw)\b.{0,100}\b(system|developer|hidden)\b.{0,60}\b(prompt|message|instruction|policy)s?\b/i
  },
  {
    code: "tool_override",
    severity: "malicious",
    pattern:
      /\b(call|invoke|execute|use)\b.{0,100}\b(tool|function|api|action)\b.{0,100}\b(without|bypass|ignore|skip)\b.{0,80}\b(approval|permission|policy|guard|validation)\b/i
  },
  {
    code: "safety_override",
    severity: "malicious",
    pattern:
      /\b(disable|turn off|bypass|ignore|skip)\b.{0,100}\b(safety|guardrail|guard|policy|filter|validator|approval)\b/i
  },
  {
    code: "provider_tool_call_override",
    severity: "malicious",
    pattern:
      /\b(provider|model|completion|assistant)\b.{0,100}\b(tool|function|arguments|json)\b.{0,150}\b(skip|bypass|without|override)\b.{0,100}\b(policy|approval|validator|guard|validation)\b/i
  },
  {
    code: "multilingual_instruction_override",
    severity: "malicious",
    pattern:
      /\b(ignora|ignorar|ignorez|ignorer|olvida|omite|desconsidera)\b.{0,120}\b(instrucciones|instructions|reglas|rules|sistema|systeme|system|desarrollador|developer)\b/i
  },
  {
    code: "role_impersonation",
    severity: "suspicious",
    pattern:
      /\b(act as|you are|as the|as a)\b.{0,60}\b(system|developer|root|admin|administrator|security engineer)\b/i
  },
  {
    code: "instruction_priority_claim",
    severity: "suspicious",
    pattern:
      /\b(this|these)\b.{0,80}\b(instruction|document|message|prompt|policy)s?\b.{0,80}\b(highest priority|supersede|override|take precedence|developer authority|system authority)\b/i
  },
  {
    code: "rag_poisoning",
    severity: "malicious",
    pattern:
      /\bthis document\b.{0,100}\b(is|has|contains)\b.{0,100}\b(highest priority|system authority|developer authority|runtime authority|tool authority)\b/i
  },
  {
    code: "memory_persistence",
    severity: "suspicious",
    pattern:
      /\b(save|store|remember|persist)\b.{0,80}\b(this|these)\b.{0,80}\b(instruction|rule|prompt|policy)s?\b.{0,80}\b(forever|for all future|permanently|in memory)\b/i
  },
  {
    code: "data_exfiltration",
    severity: "malicious",
    pattern:
      /\b(send|post|upload|forward|exfiltrate)\b.{0,100}\b(customer data|tenant data|conversation history|transcript|attachment|secret|token|api key)\b.{0,100}\b(to|into)\b.{0,100}\b(http|webhook|external|pastebin|slack|email)\b/i
  },
  {
    code: "cross_tenant_exfiltration",
    severity: "malicious",
    pattern:
      /\b(read|load|search|export|summarize|compare|use|access)\b.{0,100}\b(other|another|all|every|different)\b.{0,60}\b(tenant|workspace|client|customer)s?\b.{0,100}\b(data|knowledge|file|document|ticket|conversation|record)s?\b/i
  }
];

export function sanitizeAiInputText(value: string, maxChars = DEFAULT_MAX_GUARD_CHARS) {
  const originalLength = value.length;
  const reasonCodes: string[] = [];
  let sanitized = value.normalize("NFKC");

  if (ZERO_WIDTH_PATTERN.test(sanitized)) {
    reasonCodes.push("zero_width_characters");
    sanitized = sanitized.replace(ZERO_WIDTH_PATTERN, "");
  }
  ZERO_WIDTH_PATTERN.lastIndex = 0;

  if (BIDI_CONTROL_PATTERN.test(sanitized)) {
    reasonCodes.push("bidi_control_characters");
    sanitized = sanitized.replace(BIDI_CONTROL_PATTERN, "");
  }
  BIDI_CONTROL_PATTERN.lastIndex = 0;

  if (CONTROL_PATTERN.test(sanitized)) {
    reasonCodes.push("control_characters");
    sanitized = sanitized.replace(CONTROL_PATTERN, "");
  }
  CONTROL_PATTERN.lastIndex = 0;

  sanitized = sanitized.replace(/\r\n/g, "\n").trim();
  if (sanitized.length > maxChars) {
    reasonCodes.push("input_too_long");
    sanitized = sanitized.slice(0, maxChars);
  }

  return {
    sanitized,
    reasonCodes,
    originalLength,
    sanitizedLength: sanitized.length
  };
}

export function serializeAiGuardValue(value: unknown, maxChars = DEFAULT_MAX_GUARD_CHARS) {
  if (typeof value === "string") return value.slice(0, maxChars);
  if (value == null) return "";
  try {
    return JSON.stringify(value).slice(0, maxChars);
  } catch {
    return String(value).slice(0, maxChars);
  }
}

export function redactAiGuardSample(value: string) {
  return value
    .replace(TOKEN_PATTERN, "[REDACTED_TOKEN]")
    .replace(EMAIL_PATTERN, "[REDACTED_EMAIL]")
    .replace(PHONE_PATTERN, "[REDACTED_PHONE]")
    .slice(0, SAMPLE_LENGTH);
}

export function inspectAiInput(input: {
  text: string;
  policyMode?: string | null;
  maxChars?: number;
}): AiGuardInspection {
  const normalized = sanitizeAiInputText(input.text, input.maxChars);
  const reasonCodes = [...normalized.reasonCodes];
  let severity: AiGuardSeverity = reasonCodes.length > 0 ? "suspicious" : "clean";

  if (TOKEN_PATTERN.test(normalized.sanitized)) {
    reasonCodes.push("secret_token_exposure");
    severity = "malicious";
  }
  TOKEN_PATTERN.lastIndex = 0;

  for (const { code, pattern, severity: patternSeverity } of PROMPT_INJECTION_PATTERNS) {
    if (pattern.test(normalized.sanitized)) {
      reasonCodes.push(code);
      if (patternSeverity === "malicious") {
        severity = "malicious";
      } else if (severity === "clean") {
        severity = "suspicious";
      }
    }
  }

  let decision: AiGuardDecision = "allow";
  if (severity === "malicious") {
    decision = "block";
  } else if (severity === "suspicious") {
    decision = input.policyMode === "hybrid_review" || input.policyMode === "draft_only"
      ? "review"
      : "read_only";
  }

  return {
    guardVersion: AI_GUARD_VERSION,
    severity,
    decision,
    reasonCodes: Array.from(new Set(reasonCodes)),
    sanitizedText: normalized.sanitized,
    contentSample: redactAiGuardSample(normalized.sanitized),
    originalLength: normalized.originalLength,
    sanitizedLength: normalized.sanitizedLength
  };
}

export function isAiGuardUnsafe(inspection: AiGuardInspection) {
  return inspection.severity !== "clean";
}

export async function recordAiGuardEvent(input: {
  tenantKey: string;
  workspaceKey?: string | null;
  runId?: string | null;
  integrationId?: string | null;
  sourceKind: AiGuardSourceKind;
  sourceId?: string | null;
  subject?: string | null;
  inspection: AiGuardInspection;
  metadata?: Record<string, unknown> | null;
}) {
  await db.query(
    `INSERT INTO ai_guard_events (
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
       metadata
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [
      input.tenantKey,
      input.workspaceKey ?? "primary",
      input.runId ?? null,
      input.integrationId ?? null,
      input.sourceKind,
      input.sourceId ?? null,
      input.subject ?? null,
      input.inspection.severity,
      input.inspection.decision,
      input.inspection.reasonCodes,
      input.inspection.guardVersion,
      input.inspection.contentSample,
      {
        ...(input.metadata ?? {}),
        originalLength: input.inspection.originalLength,
        sanitizedLength: input.inspection.sanitizedLength
      }
    ]
  );
}
