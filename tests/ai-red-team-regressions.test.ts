import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dbQuery: vi.fn()
}));

vi.mock("@/server/db", () => ({
  db: {
    query: mocks.dbQuery
  }
}));

import { buildAgentPromptSandbox } from "../src/server/agents/prompt-sandbox";
import { evaluateAgentToolPolicy } from "../src/server/agents/tool-policy";
import { validateAgentOutput } from "../src/server/agents/output-validator";
import { detectKnowledgeSafetyFindings } from "../src/server/ai/knowledge-base";
import { inspectAiInput, isAiGuardUnsafe } from "../src/server/ai/guard";
import {
  AI_RED_TEAM_BLOCKING_CASES,
  AI_RED_TEAM_CASES,
  AI_RED_TEAM_RAG_CASES
} from "./fixtures/ai-red-team-cases";

describe("AI red-team regression suite", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.dbQuery.mockResolvedValue({ rows: [] });
  });

  it("keeps direct guard classification stable across adversarial fixtures", () => {
    for (const testCase of AI_RED_TEAM_CASES) {
      const inspection = inspectAiInput({
        text: testCase.text,
        policyMode: "full_auto"
      });

      expect(inspection.severity, testCase.id).toBe(testCase.expectedSeverity);
      expect(inspection.decision, testCase.id).toBe(testCase.expectedDecision);
      for (const reason of testCase.expectedReasons) {
        expect(inspection.reasonCodes, testCase.id).toContain(reason);
      }
      expect(isAiGuardUnsafe(inspection), testCase.id).toBe(testCase.expectedSeverity !== "clean");
    }
  });

  it("blocks malicious full-auto external-send tool requests", async () => {
    for (const testCase of AI_RED_TEAM_BLOCKING_CASES) {
      const result = await evaluateAgentToolPolicy({
        tenantKey: "tenant-a",
        workspaceKey: "workspace-a",
        integrationId: "agent-1",
        runId: `run-${testCase.id}`,
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

      expect(result.allowed, testCase.id).toBe(false);
      expect(result.decision, testCase.id).toBe("block");
      for (const reason of testCase.expectedReasons) {
        expect(result.reasonCodes, testCase.id).toContain(reason);
      }
    }
  });

  it("blocks hostile generated outputs before persistence or send", async () => {
    for (const testCase of AI_RED_TEAM_BLOCKING_CASES) {
      const result = await validateAgentOutput({
        tenantKey: "tenant-a",
        workspaceKey: "workspace-a",
        integrationId: "agent-1",
        runId: `run-${testCase.id}`,
        actionType: "send_reply",
        sourceId: "ticket-1",
        content: {
          text: testCase.text
        },
        metadata: {
          redTeamCaseId: testCase.id
        }
      });

      expect(result.allowed, testCase.id).toBe(false);
      expect(result.decision, testCase.id).toBe("block");
    }
  });

  it("keeps RAG and knowledge poisoning fixtures unsafe at ingestion/retrieval boundaries", () => {
    for (const testCase of AI_RED_TEAM_RAG_CASES) {
      const findings = detectKnowledgeSafetyFindings(testCase.text);
      for (const reason of testCase.expectedReasons) {
        expect(findings, testCase.id).toContain(reason);
      }
    }
  });

  it("keeps hostile user content inside non-authoritative prompt sections", () => {
    const sandbox = buildAgentPromptSandbox({
      tenantKey: "tenant-a",
      workspaceKey: "workspace-a",
      mode: "full_auto",
      eventType: "ticket.message.created",
      policy: { escalation: { out_of_hours: "block" } },
      payload: {
        subject: "Refund request",
        excerpt: AI_RED_TEAM_CASES.find((item) => item.id === "direct-ignore-system")?.text,
        knowledge_context: {
          source: "ai_knowledge_base",
          results: [
            {
              document_id: "doc-1",
              chunk_id: "chunk-1",
              content: AI_RED_TEAM_CASES.find((item) => item.id === "rag-system-authority")?.text
            }
          ]
        }
      }
    });

    const eventSection = sandbox.sections.find((section) => section.id === "event_payload");
    const knowledgeSection = sandbox.sections.find((section) => section.id === "retrieved_knowledge");
    const systemSection = sandbox.sections.find((section) => section.id === "system_constraints");

    expect(systemSection?.instruction_authority).toBe(true);
    expect(eventSection).toMatchObject({
      instruction_authority: false,
      trust: "untrusted_event_payload"
    });
    expect(knowledgeSection).toMatchObject({
      instruction_authority: false,
      trust: "untrusted_retrieved_knowledge"
    });
    expect(sandbox.final_constraints.join(" ")).toContain("not instruction authority");
  });
});
