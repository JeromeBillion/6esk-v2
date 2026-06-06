export const AGENT_POLICY_MODE_VALUES = [
  "draft_only",
  "auto_send",
  "hybrid_review",
  "full_auto"
] as const;

export type AgentPolicyMode = (typeof AGENT_POLICY_MODE_VALUES)[number];

export type CanonicalAgentPolicyMode = "hybrid_review" | "full_auto";

export function normalizeAgentPolicyMode(
  mode: string | null | undefined
): CanonicalAgentPolicyMode {
  if (mode === "auto_send" || mode === "full_auto") {
    return "full_auto";
  }
  return "hybrid_review";
}

export function isFullAutoPolicyMode(mode: string | null | undefined) {
  return normalizeAgentPolicyMode(mode) === "full_auto";
}

export function isHybridReviewPolicyMode(mode: string | null | undefined) {
  return normalizeAgentPolicyMode(mode) === "hybrid_review";
}

export function policyModeLabel(mode: string | null | undefined) {
  return isFullAutoPolicyMode(mode) ? "Full auto" : "Hybrid review";
}
