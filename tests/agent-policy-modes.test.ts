import { describe, expect, it } from "vitest";
import {
  isFullAutoPolicyMode,
  isHybridReviewPolicyMode,
  normalizeAgentPolicyMode
} from "../src/server/agents/policy-modes";

describe("agent policy modes", () => {
  it("normalizes legacy policy modes into canonical v2 modes", () => {
    expect(normalizeAgentPolicyMode("auto_send")).toBe("full_auto");
    expect(normalizeAgentPolicyMode("full_auto")).toBe("full_auto");
    expect(normalizeAgentPolicyMode("draft_only")).toBe("hybrid_review");
    expect(normalizeAgentPolicyMode("hybrid_review")).toBe("hybrid_review");
    expect(normalizeAgentPolicyMode("unknown")).toBe("hybrid_review");
  });

  it("keeps full autonomy separate from hybrid review", () => {
    expect(isFullAutoPolicyMode("full_auto")).toBe(true);
    expect(isFullAutoPolicyMode("hybrid_review")).toBe(false);
    expect(isHybridReviewPolicyMode("hybrid_review")).toBe(true);
    expect(isHybridReviewPolicyMode("full_auto")).toBe(false);
  });
});
