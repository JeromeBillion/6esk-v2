import { beforeEach, describe, expect, it, vi } from "vitest";

const TENANT_ID = "00000000-0000-0000-0000-000000000001";
const RUN_ID = "22222222-2222-4222-8222-222222222222";

const mocks = vi.hoisted(() => ({
  dbQuery: vi.fn(),
  recordAuditLog: vi.fn()
}));

vi.mock("@/server/db", () => ({
  db: {
    query: mocks.dbQuery
  }
}));

vi.mock("@/server/audit", () => ({
  recordAuditLog: mocks.recordAuditLog
}));

import { buildAgentPromptSandbox } from "@/server/agents/prompt-sandbox";
import { evaluateAgentToolPolicy } from "@/server/agents/tool-policy";
import { validateAgentOutput } from "@/server/agents/output-validator";
import { classifyKnowledgeTextSafety } from "@/server/ai/knowledge-safety";
import { evaluatePromptSafety } from "@/server/ai/prompt-safety";
import {
  AI_RED_TEAM_CASES,
  AI_RED_TEAM_KNOWLEDGE_CASES,
  AI_RED_TEAM_UNSAFE_CASES
} from "./fixtures/ai-red-team-cases";

describe("AI red-team regression suite", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.dbQuery.mockResolvedValue({ rows: [] });
    mocks.recordAuditLog.mockResolvedValue(undefined);
  });

  it("keeps direct prompt-safety classification stable across adversarial fixtures", () => {
    for (const testCase of AI_RED_TEAM_CASES) {
      const decision = evaluatePromptSafety({
        text: testCase.text,
        source: "red_team_fixture"
      });

      expect(decision.decision, testCase.id).toBe(testCase.expectedPromptDecision);
      expect(decision.riskLevel, testCase.id).toBe(testCase.expectedRiskLevel);
      for (const reason of testCase.expectedReasonCodes) {
        expect(decision.flags.map((flag) => flag.code), testCase.id).toContain(reason);
      }
    }
  });

  it("applies the full-auto tool policy to red-team external-send requests", async () => {
    for (const testCase of AI_RED_TEAM_CASES) {
      const result = await evaluateAgentToolPolicy({
        tenantId: TENANT_ID,
        integrationId: "agent-1",
        runId: RUN_ID,
        policyMode: "full_auto",
        actionType: "send_reply",
        resource: { ticketId: "ticket-1" },
        content: {
          text: testCase.text
        },
        metadata: {
          redTeamCaseId: testCase.id
        }
      });

      expect(result.decision, testCase.id).toBe(testCase.expectedToolDecision);
      expect(result.allowed, testCase.id).toBe(testCase.expectedToolDecision === "allow");
      for (const reason of testCase.expectedReasonCodes) {
        expect(result.reasonCodes, testCase.id).toContain(reason);
      }
    }
  });

  it("blocks unsafe generated output before persistence or send", async () => {
    for (const testCase of AI_RED_TEAM_UNSAFE_CASES) {
      const result = await validateAgentOutput({
        tenantId: TENANT_ID,
        integrationId: "agent-1",
        runId: RUN_ID,
        actionType: "send_reply",
        resourceType: "ticket",
        resourceId: "ticket-1",
        content: {
          text: testCase.text
        },
        metadata: {
          redTeamCaseId: testCase.id
        }
      });

      expect(result.allowed, testCase.id).toBe(false);
      expect(result.decision, testCase.id).toBe("block");
      for (const reason of testCase.expectedReasonCodes) {
        expect(result.reasonCodes, testCase.id).toContain(reason);
      }
    }
  });

  it("keeps RAG and knowledge poisoning fixtures unsafe at ingestion boundaries", () => {
    for (const testCase of AI_RED_TEAM_KNOWLEDGE_CASES) {
      const safety = classifyKnowledgeTextSafety(testCase.text);

      expect(safety.riskLevel, testCase.id).toBe("high");
      for (const reason of testCase.expectedKnowledgeCodes ?? []) {
        expect(safety.flags.map((flag) => flag.code), testCase.id).toContain(reason);
      }
    }
  });

  it("keeps hostile user and SOP text inside non-authoritative prompt sections", () => {
    const directAttack = AI_RED_TEAM_CASES.find((item) => item.id === "direct-ignore-system");
    const ragAttack = AI_RED_TEAM_CASES.find((item) => item.id === "rag-system-authority");

    const sandbox = buildAgentPromptSandbox({
      tenantId: TENANT_ID,
      runId: RUN_ID,
      mode: "full_auto",
      eventType: "ticket.message.created",
      policy: { escalation: { out_of_hours: "block" } },
      payload: {
        subject: "Refund request",
        excerpt: directAttack?.text,
        dexter_rag_context: {
          schema_version: "dexter_rag_context.v1",
          snippets: [
            {
              citation_id: "kb:1",
              text: ragAttack?.text
            }
          ]
        }
      }
    });

    const eventSection = sandbox.sections.find((section) => section.id === "event_payload");
    const knowledgeSection = sandbox.sections.find((section) => section.id === "retrieved_knowledge");
    const systemSection = sandbox.sections.find((section) => section.id === "system_constraints");

    expect(systemSection).toMatchObject({
      instructionAuthority: true,
      trust: "system_constraints"
    });
    expect(eventSection).toMatchObject({
      instructionAuthority: false,
      trust: "untrusted_event_payload"
    });
    expect(knowledgeSection).toMatchObject({
      instructionAuthority: false,
      trust: "untrusted_retrieved_knowledge"
    });
    expect(sandbox.finalConstraints.join(" ")).toContain("not instruction authority");
  });
});
