import {
  inspectAiInput,
  isAiGuardUnsafe,
  recordAiGuardEvent,
  serializeAiGuardValue
} from "@/server/ai/guard";

export type AgentOutputValidationDecision = "allow" | "block";

function detailForDecision(reasonCodes: string[]) {
  return `AI output validator blocked unsafe generated content: ${reasonCodes.join(", ")}.`;
}

export async function validateAgentOutput(input: {
  tenantKey: string;
  workspaceKey?: string | null;
  runId?: string | null;
  integrationId?: string | null;
  actionType: string;
  sourceId?: string | null;
  content: unknown;
  metadata?: Record<string, unknown> | null;
}) {
  const inspection = inspectAiInput({
    text: serializeAiGuardValue(input.content),
    policyMode: "full_auto"
  });

  if (!isAiGuardUnsafe(inspection)) {
    return {
      allowed: true,
      decision: "allow" as AgentOutputValidationDecision,
      reasonCodes: inspection.reasonCodes,
      detail: null,
      inspection
    };
  }

  await recordAiGuardEvent({
    tenantKey: input.tenantKey,
    workspaceKey: input.workspaceKey,
    runId: input.runId,
    integrationId: input.integrationId,
    sourceKind: "agent_output",
    sourceId: input.sourceId,
    subject: input.actionType,
    inspection: {
      ...inspection,
      decision: "block"
    },
    metadata: input.metadata
  });

  return {
    allowed: false,
    decision: "block" as AgentOutputValidationDecision,
    reasonCodes: inspection.reasonCodes,
    detail: detailForDecision(inspection.reasonCodes),
    inspection
  };
}
