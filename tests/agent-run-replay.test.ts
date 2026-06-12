import { beforeEach, describe, expect, it, vi } from "vitest";

const TENANT_ID = "00000000-0000-0000-0000-000000000001";
const INTEGRATION_ID = "11111111-1111-4111-8111-111111111111";
const RUN_ID = "22222222-2222-4222-8222-222222222222";
const NOW = new Date("2026-06-12T10:00:00.000Z");

const mocks = vi.hoisted(() => ({
  db: {
    query: vi.fn()
  }
}));

vi.mock("@/server/db", () => ({
  db: mocks.db
}));

import { getAgentRunReplay } from "@/server/agents/run-replay";

function buildRun(overrides: Record<string, unknown> = {}) {
  return {
    id: RUN_ID,
    tenant_id: TENANT_ID,
    integration_id: INTEGRATION_ID,
    run_type: "outbox_event",
    status: "completed",
    lane_key: `tenant:${TENANT_ID}:ticket:33333333-3333-4333-8333-333333333333`,
    source_channel: "ticket",
    resource_type: "ticket",
    resource_id: "33333333-3333-4333-8333-333333333333",
    trigger_event_type: "ticket.message.created",
    trigger_outbox_id: "44444444-4444-4444-8444-444444444444",
    idempotency_key: "ticket-message-1",
    requested_scopes: ["tickets:read"],
    rollout_mode: "full_auto",
    provider_mode: "managed",
    failure_reason: null,
    metadata: {
      commandEnvelope: {
        command: "agent.run.create",
        secretToken: "sk-testsecret123456789",
        requesterEmail: "customer@example.com"
      }
    },
    created_at: NOW,
    queued_at: NOW,
    started_at: NOW,
    waiting_since: null,
    completed_at: NOW,
    failed_at: null,
    timed_out_at: null,
    cancelled_at: null,
    lost_at: null,
    updated_at: NOW,
    ...overrides
  };
}

describe("getAgentRunReplay", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects malformed run ids before querying", async () => {
    const replay = await getAgentRunReplay({
      tenantId: TENANT_ID,
      integrationId: INTEGRATION_ID,
      runId: "not-a-run-id"
    });

    expect(replay).toBeNull();
    expect(mocks.db.query).not.toHaveBeenCalled();
  });

  it("assembles complete tenant-scoped run replay evidence with redaction", async () => {
    mocks.db.query
      .mockResolvedValueOnce({ rows: [buildRun()] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "event-1",
            run_id: RUN_ID,
            sequence: 1,
            event_type: "agent.run.queued",
            status: "queued",
            summary: "Queued ticket.message.created",
            event_data: { authorization: "Bearer token", customerEmail: "customer@example.com" },
            created_at: NOW
          }
        ]
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "step-1",
            run_id: RUN_ID,
            step_index: 0,
            step_type: "tool:send_reply",
            status: "completed",
            summary: "Agent tool completed",
            metadata: { apiKey: "secret-value" },
            started_at: NOW,
            completed_at: NOW,
            failed_at: null,
            created_at: NOW,
            updated_at: NOW
          }
        ]
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "tool-1",
            run_id: RUN_ID,
            step_id: "step-1",
            tool_name: "send_reply",
            status: "completed",
            requested_scopes: ["tickets:write"],
            args_summary: { to: "customer@example.com" },
            result_summary: { providerToken: "secret" },
            idempotency_key: "send-1",
            error_message: null,
            created_at: NOW,
            updated_at: NOW
          }
        ]
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "policy-1",
            integration_id: INTEGRATION_ID,
            run_id: RUN_ID,
            policy_mode: "full_auto",
            rollout_mode: "full_auto",
            action_type: "send_reply",
            tool_class: "external_send",
            decision: "allow",
            reason_codes: [],
            resource: { ticketId: "33333333-3333-4333-8333-333333333333" },
            prompt_safety: { contentSample: "Reply to customer@example.com" },
            metadata: { sharedSecret: "secret" },
            created_at: NOW
          }
        ]
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "retrieval-1",
            run_id: RUN_ID,
            resource_type: "ticket",
            resource_id: "33333333-3333-4333-8333-333333333333",
            query_purpose: "dexter_runtime_context",
            query_summary: "Customer email customer@example.com asks about returns",
            filters: { authorization: "secret" },
            result_document_version_ids: ["55555555-5555-4555-8555-555555555555"],
            result_chunk_ids: ["66666666-6666-4666-8666-666666666666"],
            scores: [{ score: 0.8 }],
            confidence: "0.8",
            outcome: "proposed_action",
            usage_metadata: { refreshToken: "secret" },
            created_at: NOW
          }
        ]
      });

    const replay = await getAgentRunReplay({
      tenantId: TENANT_ID,
      integrationId: INTEGRATION_ID,
      runId: RUN_ID
    });

    expect(replay).toMatchObject({
      status: "complete",
      missingEvidence: [],
      run: {
        id: RUN_ID,
        tenant_id: TENANT_ID,
        metadata: {
          commandEnvelope: {
            command: "agent.run.create",
            secretToken: "[REDACTED_SECRET]",
            requesterEmail: "[REDACTED_EMAIL]"
          }
        }
      },
      evidence: {
        toolCalls: [{ tool_name: "send_reply", status: "completed" }],
        policyDecisions: [{ action_type: "send_reply", decision: "allow" }],
        knowledgeRetrievals: [{ query_summary: "Customer email [REDACTED_EMAIL] asks about returns" }]
      }
    });
    expect(mocks.db.query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("FROM agent_runs"),
      [TENANT_ID, INTEGRATION_ID, RUN_ID]
    );
  });

  it("marks blocked runs even when evidence is partial", async () => {
    mocks.db.query
      .mockResolvedValueOnce({
        rows: [
          buildRun({
            status: "queued",
            metadata: {}
          })
        ]
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "tool-1",
            run_id: RUN_ID,
            step_id: null,
            tool_name: "send_reply",
            status: "denied",
            requested_scopes: [],
            args_summary: {},
            result_summary: {},
            idempotency_key: null,
            error_message: "blocked",
            created_at: NOW,
            updated_at: NOW
          }
        ]
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "policy-1",
            integration_id: INTEGRATION_ID,
            run_id: RUN_ID,
            policy_mode: "full_auto",
            rollout_mode: "full_auto",
            action_type: "send_reply",
            tool_class: "external_send",
            decision: "block",
            reason_codes: ["instruction_override"],
            resource: {},
            prompt_safety: {},
            metadata: {},
            created_at: NOW
          }
        ]
      })
      .mockResolvedValueOnce({ rows: [] });

    const replay = await getAgentRunReplay({
      tenantId: TENANT_ID,
      integrationId: INTEGRATION_ID,
      runId: RUN_ID
    });

    expect(replay).toMatchObject({
      status: "blocked",
      missingEvidence: expect.arrayContaining(["command_envelope", "run_events"])
    });
    expect(replay?.evidence.policyDecisions[0]?.decision).toBe("block");
  });
});
