export type PromptSafetyRiskLevel = "none" | "low" | "medium" | "high";

export type PromptSafetyFlag = {
  code: string;
  severity: Exclude<PromptSafetyRiskLevel, "none">;
};

export type PromptSafetyDecision = {
  guardVersion: "prompt-safety-rules.v1";
  source: string;
  trustBoundary: "user_controlled_untrusted";
  normalizedText: string;
  removedCharacterCount: number;
  wasTruncated: boolean;
  riskLevel: PromptSafetyRiskLevel;
  flags: PromptSafetyFlag[];
  decision: "allow" | "allow_sanitized" | "downgrade" | "deny";
  toolPolicy: {
    mode: "normal" | "read_only" | "no_tools";
    allowPersistentMemory: boolean;
    allowExternalActions: boolean;
    forceKnowledgeSafetyFilter: boolean;
  };
};

const DEFAULT_MAX_PROMPT_LENGTH = 4000;
const SAMPLE_LENGTH = 700;
const ZERO_WIDTH_AND_CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g;
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PHONE_PATTERN = /\+?\d[\d\s().-]{7,}\d/g;
const PROMPT_CANARY_PATTERN = /\b6ESK_PROMPT_CANARY_[A-Z0-9_-]{6,}\b/gi;
const TOKEN_PATTERN =
  /\b(?:sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_]{12,}|xox[baprs]-[A-Za-z0-9-]{12,}|AIza[0-9A-Za-z_-]{12,})\b/g;

const PROMPT_SAFETY_RULES: Array<{
  code: string;
  severity: PromptSafetyFlag["severity"];
  pattern: RegExp;
}> = [
  {
    code: "instruction_override",
    severity: "high",
    pattern: /\b(ignore|override|forget|disregard|delete)\b.{0,100}\b(system|developer|previous|above|prior|hidden)\b.{0,80}\binstructions?\b/i
  },
  {
    code: "system_prompt_exfiltration",
    severity: "high",
    pattern: /\b(reveal|print|show|repeat|send|dump|exfiltrate|leak)\b.{0,100}\b(system prompt|developer message|hidden prompt|hidden instruction|policy|instructions?)\b/i
  },
  {
    code: "prompt_leak_exact_text",
    severity: "high",
    pattern: /\b(copy|quote|provide|return|write)\b.{0,100}\b(exact|verbatim|full|raw)\b.{0,100}\b(system|developer|hidden)\b.{0,60}\b(prompt|message|instruction|policy)s?\b/i
  },
  {
    code: "secret_exfiltration",
    severity: "high",
    pattern: /\b(reveal|print|show|send|dump|exfiltrate|leak)\b.{0,100}\b(api keys?|tokens?|passwords?|credentials?|secrets?)\b/i
  },
  {
    code: "secret_token_exposure",
    severity: "high",
    pattern: TOKEN_PATTERN
  },
  {
    code: "prompt_canary_leakage",
    severity: "high",
    pattern: PROMPT_CANARY_PATTERN
  },
  {
    code: "cross_tenant_or_customer_exfiltration",
    severity: "high",
    pattern: /\b(read|load|search|export|summarize|compare|use|access|show|send)?\b.{0,60}\b(other|another|all|every|next|different)\b.{0,60}\b(tenant|client|customer|account|workspace|company)\b.{0,100}\b(data|records?|tickets?|messages?|queries|phone|email|conversation|history|documents?|knowledge)\b/i
  },
  {
    code: "tool_policy_bypass",
    severity: "high",
    pattern: /\b(bypass|skip|disable|avoid|ignore)\b.{0,100}\b(approval|human review|policy|permission|scope|guardrail|rate limit|tool check|tenant check)\b/i
  },
  {
    code: "tool_coercion",
    severity: "medium",
    pattern: /\b(call|invoke|run|execute|trigger|use)\b.{0,100}\b(tool|function|shell|command|webhook|api|database|sql)\b/i
  },
  {
    code: "provider_tool_call_override",
    severity: "high",
    pattern: /\b(provider|model|completion|assistant)\b.{0,100}\b(tool|function|arguments|json)\b.{0,150}\b(skip|bypass|without|override)\b.{0,100}\b(policy|approval|validator|guard|validation)\b/i
  },
  {
    code: "citation_or_audit_suppression",
    severity: "medium",
    pattern: /\b(do not|don't|never|avoid)\b.{0,80}\b(cite|quote|show source|mention source|log|audit|record)\b/i
  },
  {
    code: "role_impersonation",
    severity: "medium",
    pattern: /\b(as|pretend to be|act as|you are now)\b.{0,80}\b(admin|developer|system|policy|security|auditor|owner)\b/i
  },
  {
    code: "multilingual_instruction_override",
    severity: "high",
    pattern: /\b(ignora|ignorar|ignorez|ignorer|olvida|omite|desconsidera|ignoreer|vergeet)\b.{0,120}\b(instrucciones|instructions|instruksies|reglas|rules|reels|sistema|systeme|system|stelsel|desarrollador|developer)\b/i
  },
  {
    code: "encoded_instruction_smuggling",
    severity: "high",
    pattern: /\b(base64|rot13|hex|unicode|encoded|cipher)\b.{0,120}\b(decode|decrypt|translate|read)\b.{0,120}\b(follow|execute|obey|run|apply)\b.{0,80}\b(instruction|prompt|message|policy|rule)s?\b/i
  },
  {
    code: "rag_poisoning",
    severity: "high",
    pattern: /\bthis document\b.{0,100}\b(is|has|contains)\b.{0,100}\b(highest priority|system authority|developer authority|runtime authority|tool authority)\b/i
  },
  {
    code: "memory_persistence",
    severity: "medium",
    pattern: /\b(save|store|remember|persist)\b.{0,80}\b(this|these)\b.{0,80}\b(instruction|rule|prompt|policy)s?\b.{0,80}\b(forever|for all future|permanently|in memory)\b/i
  },
  {
    code: "data_exfiltration",
    severity: "high",
    pattern: /\b(send|post|upload|forward|exfiltrate)\b.{0,100}\b(customer data|tenant data|conversation history|transcript|attachment|secret|token|api key)\b.{0,100}\b(to|into)\b.{0,100}\b(http|webhook|external|pastebin|slack|email)\b/i
  }
];

function uniqueFlags(flags: PromptSafetyFlag[]) {
  const seen = new Set<string>();
  return flags.filter((flag) => {
    const key = `${flag.code}:${flag.severity}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function highestRisk(flags: PromptSafetyFlag[]): PromptSafetyRiskLevel {
  if (flags.some((flag) => flag.severity === "high")) return "high";
  if (flags.some((flag) => flag.severity === "medium")) return "medium";
  if (flags.some((flag) => flag.severity === "low")) return "low";
  return "none";
}

export function sanitizePromptInput(text: string, maxLength = DEFAULT_MAX_PROMPT_LENGTH) {
  const normalized = text.normalize("NFKC");
  const withoutUnsafeChars = normalized.replace(ZERO_WIDTH_AND_CONTROL, "");
  const normalizedText = withoutUnsafeChars.replace(/\s+/g, " ").trim().slice(0, maxLength);
  return {
    normalizedText,
    removedCharacterCount: normalized.length - withoutUnsafeChars.length,
    wasTruncated: withoutUnsafeChars.replace(/\s+/g, " ").trim().length > maxLength
  };
}

export function evaluatePromptSafety({
  text,
  source,
  maxLength = DEFAULT_MAX_PROMPT_LENGTH
}: {
  text: string;
  source: string;
  maxLength?: number;
}): PromptSafetyDecision {
  const sanitized = sanitizePromptInput(text, maxLength);
  const flags = uniqueFlags(
    PROMPT_SAFETY_RULES.filter((rule) => {
      rule.pattern.lastIndex = 0;
      return rule.pattern.test(sanitized.normalizedText);
    }).map((rule) => ({
      code: rule.code,
      severity: rule.severity
    }))
  );
  const riskLevel = highestRisk(flags);
  const hasSanitization = sanitized.removedCharacterCount > 0 || sanitized.wasTruncated;
  const decision =
    riskLevel === "high"
      ? "deny"
      : riskLevel === "medium"
        ? "downgrade"
        : hasSanitization
          ? "allow_sanitized"
          : "allow";

  return {
    guardVersion: "prompt-safety-rules.v1",
    source,
    trustBoundary: "user_controlled_untrusted",
    ...sanitized,
    riskLevel,
    flags,
    decision,
    toolPolicy: {
      mode: decision === "deny" ? "no_tools" : decision === "downgrade" ? "read_only" : "normal",
      allowPersistentMemory: decision !== "deny" && riskLevel !== "medium",
      allowExternalActions: decision === "allow" || decision === "allow_sanitized",
      forceKnowledgeSafetyFilter: decision === "deny" || decision === "downgrade"
    }
  };
}

export function isPromptDenied(decision: PromptSafetyDecision) {
  return decision.decision === "deny";
}

export function redactPromptSafetySample(text: string) {
  return text
    .replace(PROMPT_CANARY_PATTERN, "[REDACTED_PROMPT_CANARY]")
    .replace(TOKEN_PATTERN, "[REDACTED_TOKEN]")
    .replace(EMAIL_PATTERN, "[REDACTED_EMAIL]")
    .replace(PHONE_PATTERN, "[REDACTED_PHONE]")
    .slice(0, SAMPLE_LENGTH);
}

export function promptSafetyTelemetry(decision: PromptSafetyDecision) {
  return {
    guardVersion: decision.guardVersion,
    source: decision.source,
    trustBoundary: decision.trustBoundary,
    removedCharacterCount: decision.removedCharacterCount,
    wasTruncated: decision.wasTruncated,
    normalizedLength: decision.normalizedText.length,
    contentSample: redactPromptSafetySample(decision.normalizedText),
    riskLevel: decision.riskLevel,
    flags: decision.flags,
    decision: decision.decision,
    toolPolicy: decision.toolPolicy
  };
}
