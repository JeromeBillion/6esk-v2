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
  source: "prompt_safety" | "output_validator";
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
    ...outputSpecificFlags(promptSafety.normalizedText)
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
}) {
  const validation = evaluateAgentOutputSafety({
    content: input.content,
    source: "agent_output",
    blockMediumRisk: input.blockMediumRisk
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
      metadataKeys: Object.keys(input.metadata ?? {}).sort().slice(0, 20)
    }
  });

  return validation;
}
