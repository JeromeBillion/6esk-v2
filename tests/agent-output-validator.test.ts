import { beforeEach, describe, expect, it, vi } from "vitest";

const TENANT_ID = "00000000-0000-0000-0000-000000000001";
const RUN_ID = "22222222-2222-4222-8222-222222222222";
const ACTIVE_TICKET_ID = "11111111-1111-4111-8111-111111111111";
const CURRENT_CUSTOMER_ID = "22222222-2222-4222-8222-222222222222";
const PRIOR_TICKET_ID = "33333333-3333-4333-8333-333333333333";

const RESOLVED_CUSTOMER_CONTEXT = {
  schemaVersion: "agent-customer-output-context.v1" as const,
  activeTicketId: ACTIVE_TICKET_ID,
  activeThreadId: "thread-1",
  currentCustomerId: CURRENT_CUSTOMER_ID,
  ambiguityState: "resolved" as const,
  allowedSourceIds: {
    ticketIds: [ACTIVE_TICKET_ID, PRIOR_TICKET_ID],
    customerIds: [CURRENT_CUSTOMER_ID],
    messageIds: [],
    mailboxIds: ["mailbox-1"],
    threadIds: ["thread-1"]
  },
  sameCustomerHistoryTicketIds: [ACTIVE_TICKET_ID, PRIOR_TICKET_ID],
  customerVisibleProfileFields: ["display_name"],
  profilePiiPolicy: "minimize" as const,
  disallowedScopeExpansion: ["other_customer", "other_tenant"]
};

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

  it("blocks customer replies that cite out-of-scope source ids", async () => {
    const result = await validateAgentOutput({
      tenantId: TENANT_ID,
      integrationId: "agent-1",
      actionType: "send_reply",
      resourceType: "ticket",
      resourceId: ACTIVE_TICKET_ID,
      content: {
        text: "I checked the prior case and found the answer."
      },
      customerContext: RESOLVED_CUSTOMER_CONTEXT,
      sourceMetadata: {
        sourceTicketIds: ["99999999-9999-4999-8999-999999999999"]
      }
    });

    expect(result.allowed).toBe(false);
    expect(result.reasonCodes).toContain("customer_source_id_out_of_scope");
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "ai_output_validation_blocked",
        data: expect.objectContaining({
          customerContext: expect.objectContaining({
            ambiguityState: "resolved",
            hasCurrentCustomerId: true
          }),
          sourceMetadataKeys: ["sourceTicketIds"]
        })
      })
    );
  });

  it("blocks profile PII overexposure in customer-facing replies", async () => {
    const result = await validateAgentOutput({
      tenantId: TENANT_ID,
      actionType: "draft_reply",
      resourceType: "ticket",
      resourceId: ACTIVE_TICKET_ID,
      content: {
        text: "Your email is customer@example.com and your phone is +1 555 000 0001."
      },
      customerContext: RESOLVED_CUSTOMER_CONTEXT
    });

    expect(result.allowed).toBe(false);
    expect(result.reasonCodes).toContain("profile_pii_overexposure");
  });

  it("blocks ambiguous customer context from disclosing history", async () => {
    const result = await validateAgentOutput({
      tenantId: TENANT_ID,
      actionType: "send_reply",
      resourceType: "ticket",
      resourceId: ACTIVE_TICKET_ID,
      content: {
        text: "Your previous ticket was about a billing dispute."
      },
      customerContext: {
        ...RESOLVED_CUSTOMER_CONTEXT,
        ambiguityState: "conflicted" as const,
        currentCustomerId: null,
        allowedSourceIds: {
          ...RESOLVED_CUSTOMER_CONTEXT.allowedSourceIds,
          customerIds: [],
          ticketIds: [ACTIVE_TICKET_ID]
        },
        sameCustomerHistoryTicketIds: []
      }
    });

    expect(result.allowed).toBe(false);
    expect(result.reasonCodes).toContain("customer_context_conflicted");
  });

  it("blocks replies that expand scope to another customer", async () => {
    const result = await validateAgentOutput({
      tenantId: TENANT_ID,
      actionType: "send_reply",
      resourceType: "ticket",
      resourceId: ACTIVE_TICKET_ID,
      content: {
        text: "Another customer named Sarah asked about the same issue yesterday."
      },
      customerContext: RESOLVED_CUSTOMER_CONTEXT
    });

    expect(result.allowed).toBe(false);
    expect(result.reasonCodes).toContain("cross_customer_scope_expansion");
  });

  it("blocks customer replies that disclose internal comments", async () => {
    const result = await validateAgentOutput({
      tenantId: TENANT_ID,
      actionType: "send_reply",
      resourceType: "ticket",
      resourceId: ACTIVE_TICKET_ID,
      content: {
        text: "Our internal comment says the team expects this to become an escalation."
      },
      customerContext: RESOLVED_CUSTOMER_CONTEXT
    });

    expect(result.allowed).toBe(false);
    expect(result.reasonCodes).toContain("internal_comment_disclosure");
  });
});
