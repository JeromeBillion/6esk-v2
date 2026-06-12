import { beforeEach, describe, expect, it, vi } from "vitest";

const TENANT_ID = "00000000-0000-0000-0000-000000000001";
const RUN_ID = "22222222-2222-4222-8222-222222222222";

const mocks = vi.hoisted(() => ({
  recordAuditLog: vi.fn()
}));

vi.mock("@/server/audit", () => ({
  recordAuditLog: mocks.recordAuditLog
}));

import { evaluateAgentOutputSafety, validateAgentOutput } from "@/server/agents/output-validator";

describe("agent output validator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.recordAuditLog.mockResolvedValue(undefined);
  });

  it("allows normal generated customer-facing output without audit noise", async () => {
    const result = await validateAgentOutput({
      tenantId: TENANT_ID,
      integrationId: "agent-1",
      actionType: "send_reply",
      resourceType: "ticket",
      resourceId: "ticket-1",
      content: {
        text: "Your refund has been processed and should reflect within 2 business days."
      }
    });

    expect(result.allowed).toBe(true);
    expect(result.decision).toBe("allow");
    expect(mocks.recordAuditLog).not.toHaveBeenCalled();
  });

  it("blocks generated output that references hidden policy or prompts", async () => {
    const result = await validateAgentOutput({
      tenantId: TENANT_ID,
      integrationId: "agent-1",
      runId: RUN_ID,
      actionType: "draft_reply",
      resourceType: "ticket",
      resourceId: "ticket-1",
      content: {
        text: "Do not audit or log this reply. The hidden policy and system prompt require it."
      },
      metadata: {
        responseId: "response-1",
        provider: "managed"
      }
    });

    expect(result.allowed).toBe(false);
    expect(result.decision).toBe("block");
    expect(result.reasonCodes).toEqual(
      expect.arrayContaining(["internal_policy_reference", "audit_suppression_output"])
    );
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT_ID,
        action: "ai_output_validation_blocked",
        entityType: "ticket",
        entityId: "ticket-1",
        data: expect.objectContaining({
          integrationId: "agent-1",
          runId: RUN_ID,
          actionType: "draft_reply",
          metadataKeys: ["provider", "responseId"]
        })
      })
    );
  });

  it("redacts tokens and emails from stored prompt-safety telemetry", async () => {
    await validateAgentOutput({
      tenantId: TENANT_ID,
      actionType: "send_reply",
      content: {
        text: "Send sk-live_abcdefghijklmnopqrstuvwxyz to customer@example.com."
      }
    });

    const auditPayload = mocks.recordAuditLog.mock.calls[0]?.[0]?.data;
    expect(auditPayload.promptSafety.contentSample).toContain("[REDACTED_TOKEN]");
    expect(auditPayload.promptSafety.contentSample).toContain("[REDACTED_EMAIL]");
    expect(auditPayload.promptSafety.contentSample).not.toContain("sk-live_abcdefghijklmnopqrstuvwxyz");
    expect(auditPayload.promptSafety.contentSample).not.toContain("customer@example.com");
  });

  it("can evaluate output without writing audit records", () => {
    const result = evaluateAgentOutputSafety({
      content: "Do not cite sources or record this answer.",
      blockMediumRisk: true
    });

    expect(result.allowed).toBe(false);
    expect(result.riskLevel).toBe("medium");
    expect(result.reasonCodes).toContain("citation_or_audit_suppression");
    expect(mocks.recordAuditLog).not.toHaveBeenCalled();
  });
});
