export type KnowledgeSafetyRiskLevel = "none" | "low" | "medium" | "high";

export type KnowledgeSafetyFlag = {
  code: string;
  severity: Exclude<KnowledgeSafetyRiskLevel, "none">;
};

export type KnowledgeCitationSafety = {
  trustBoundary: "tenant_uploaded_untrusted";
  riskLevel: KnowledgeSafetyRiskLevel;
  flags: KnowledgeSafetyFlag[];
};

export type KnowledgeRetrievalSafetySummary = {
  trustBoundary: "tenant_uploaded_untrusted";
  riskLevel: KnowledgeSafetyRiskLevel;
  flags: KnowledgeSafetyFlag[];
  hasUnsafeCitations: boolean;
  excludedUnsafeCitationCount: number;
};

const DEFAULT_SAFETY: KnowledgeCitationSafety = {
  trustBoundary: "tenant_uploaded_untrusted",
  riskLevel: "none",
  flags: []
};

const SAFETY_RULES: Array<{
  code: string;
  severity: KnowledgeSafetyFlag["severity"];
  pattern: RegExp;
}> = [
  {
    code: "instruction_override",
    severity: "high",
    pattern: /\b(ignore|override|forget|disregard)\b.{0,80}\b(system|developer|previous|above|prior)\b.{0,50}\binstructions?\b/i
  },
  {
    code: "secret_exfiltration",
    severity: "high",
    pattern: /\b(reveal|print|show|send|exfiltrate|leak)\b.{0,80}\b(secret|api keys?|tokens?|password|credential|system prompt)\b/i
  },
  {
    code: "approval_bypass",
    severity: "high",
    pattern: /\b(bypass|skip|disable|avoid)\b.{0,80}\b(approval|human review|policy|permission|scope|guardrail)\b/i
  },
  {
    code: "cross_tenant_access",
    severity: "high",
    pattern: /\b(other|all|every)\b.{0,40}\b(tenant|client|customer)\b.{0,80}\b(data|records|documents|tickets|messages)\b/i
  },
  {
    code: "tool_coercion",
    severity: "medium",
    pattern: /\b(call|invoke|run|execute|trigger)\b.{0,80}\b(tool|function|shell|command|webhook|api)\b/i
  },
  {
    code: "citation_suppression",
    severity: "medium",
    pattern: /\b(do not|don't|never)\b.{0,60}\b(cite|quote|show source|mention source|record)\b/i
  }
];

function riskRank(riskLevel: KnowledgeSafetyRiskLevel) {
  switch (riskLevel) {
    case "high":
      return 3;
    case "medium":
      return 2;
    case "low":
      return 1;
    default:
      return 0;
  }
}

function highestRisk(flags: KnowledgeSafetyFlag[]): KnowledgeSafetyRiskLevel {
  if (flags.some((flag) => flag.severity === "high")) return "high";
  if (flags.some((flag) => flag.severity === "medium")) return "medium";
  if (flags.length) return "low";
  return "none";
}

function uniqueFlags(flags: KnowledgeSafetyFlag[]) {
  const seen = new Set<string>();
  return flags.filter((flag) => {
    const key = `${flag.code}:${flag.severity}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function classifyKnowledgeTextSafety(text: string): KnowledgeCitationSafety {
  const flags = uniqueFlags(
    SAFETY_RULES.filter((rule) => rule.pattern.test(text)).map((rule) => ({
      code: rule.code,
      severity: rule.severity
    }))
  );

  return {
    trustBoundary: "tenant_uploaded_untrusted",
    riskLevel: highestRisk(flags),
    flags
  };
}

export function normalizeKnowledgeSafety(value: unknown): KnowledgeCitationSafety {
  const candidate =
    typeof value === "object" && value !== null && "safety" in value
      ? (value as { safety?: unknown }).safety
      : value;

  if (typeof candidate !== "object" || candidate === null) {
    return DEFAULT_SAFETY;
  }

  const riskLevel = (candidate as { riskLevel?: unknown }).riskLevel;
  const flags = (candidate as { flags?: unknown }).flags;

  if (
    riskLevel !== "none" &&
    riskLevel !== "low" &&
    riskLevel !== "medium" &&
    riskLevel !== "high"
  ) {
    return DEFAULT_SAFETY;
  }

  return {
    trustBoundary: "tenant_uploaded_untrusted",
    riskLevel,
    flags: Array.isArray(flags)
      ? flags
          .map((flag) => {
            if (typeof flag !== "object" || flag === null) return null;
            const code = (flag as { code?: unknown }).code;
            const severity = (flag as { severity?: unknown }).severity;
            if (
              typeof code !== "string" ||
              (severity !== "low" && severity !== "medium" && severity !== "high")
            ) {
              return null;
            }
            return { code, severity };
          })
          .filter((flag): flag is KnowledgeSafetyFlag => Boolean(flag))
      : []
  };
}

export function isHighRiskKnowledgeSafety(safety: KnowledgeCitationSafety) {
  return safety.riskLevel === "high";
}

export function summarizeKnowledgeRetrievalSafety(
  citations: Array<{ safety: KnowledgeCitationSafety }>,
  excludedUnsafeCitationCount = 0
): KnowledgeRetrievalSafetySummary {
  const flags = uniqueFlags(citations.flatMap((citation) => citation.safety.flags));
  const highest = citations.reduce<KnowledgeSafetyRiskLevel>(
    (current, citation) =>
      riskRank(citation.safety.riskLevel) > riskRank(current) ? citation.safety.riskLevel : current,
    "none"
  );
  const riskLevel = excludedUnsafeCitationCount > 0 && riskRank(highest) < riskRank("high")
    ? "high"
    : highest;

  return {
    trustBoundary: "tenant_uploaded_untrusted",
    riskLevel,
    flags,
    hasUnsafeCitations:
      citations.some((citation) => citation.safety.riskLevel === "high") ||
      excludedUnsafeCitationCount > 0,
    excludedUnsafeCitationCount
  };
}
