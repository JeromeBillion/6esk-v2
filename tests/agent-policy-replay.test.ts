import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dbQuery: vi.fn()
}));

vi.mock("@/server/db", () => ({
  db: {
    query: mocks.dbQuery
  }
}));

import { getAgentPolicyReplay } from "../src/server/agents/policy-replay";

const RUN_ID = "11111111-1111-4111-8111-111111111111";
const AGENT_ID = "22222222-2222-4222-8222-222222222222";
const NOW = new Date("2026-05-24T10:00:00.000Z");

function buildRun(overrides: Record<string, unknown> = {}) {
  return {
    id: RUN_ID,
    tenant_key: "tenant-a",
    workspace_key: "workspace-a",
    integration_id: AGENT_ID,
    mode: "full_auto",
    status: "completed",
    lane_key: "tenant-a:ticket:ticket-1",
    source_event_type: "ticket.created",
    resource: { ticket_id: "ticket-1" },
    command_envelope: {
      schema_version: "agent-command.v1",
      run_id: RUN_ID,
      payload: {
        accessToken: "sk-testsecret123456789",
        requesterEmail: "customer@example.com"
      },
      prompt_sandbox: {
        schema_version: "agent-prompt-sandbox.v1",
        template_key: "dexter_agent_runtime",
        template_version: "2026-05-24.agent-sandbox.v1",
        template_hash: "hash-1"
      }
    },
    idempotency_key: "ticket.created:ticket-1",
    error: null,
    queued_at: NOW,
    dispatched_at: NOW,
    completed_at: NOW,
    created_at: NOW,
    updated_at: NOW,
    ...overrides
  };
}

describe("agent policy replay", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects malformed run ids before querying the ledger", async () => {
    const replay = await getAgentPolicyReplay({
      runId: "not-a-run-id",
      integrationId: AGENT_ID,
      scope: { tenantKey: "tenant-a", workspaceKey: "workspace-a" }
    });

    expect(replay).toBeNull();
    expect(mocks.dbQuery).not.toHaveBeenCalled();
  });

  it("assembles complete tenant-scoped replay evidence", async () => {
    mocks.dbQuery
      .mockResolvedValueOnce({ rows: [buildRun()] })
      .mockResolvedValueOnce({
        rows: [{ id: "event-1", run_id: RUN_ID, event_type: "agent.run.create", status: "queued", data: {}, created_at: NOW }]
      })
      .mockResolvedValueOnce({
        rows: [{ id: "step-1", run_id: RUN_ID, step_type: "send_reply", status: "ok", input: {}, output: {}, error: null, started_at: NOW, completed_at: NOW }]
      })
      .mockResolvedValueOnce({
        rows: [{ id: "tool-1", run_id: RUN_ID, step_id: "step-1", tool_name: "send_reply", status: "ok", request: {}, response: {}, error: null, requested_at: NOW, completed_at: NOW }]
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{ id: "policy-1", tenant_key: "tenant-a", workspace_key: "workspace-a", run_id: RUN_ID, integration_id: AGENT_ID, policy_mode: "full_auto", tool_name: "send_reply", tool_class: "external_send", decision: "allow", reason_codes: [], resource: {}, metadata: {}, created_at: NOW }]
      })
      .mockResolvedValueOnce({
        rows: [{ id: "template-1", tenant_key: "tenant-a", workspace_key: "workspace-a", template_key: "dexter_agent_runtime", template_version: "2026-05-24.agent-sandbox.v1", status: "active", template_hash: "hash-1", activated_at: NOW, retired_at: null, metadata: {}, created_at: NOW, updated_at: NOW }]
      });

    const replay = await getAgentPolicyReplay({
      runId: RUN_ID,
      integrationId: AGENT_ID,
      scope: { tenantKey: "tenant-a", workspaceKey: "workspace-a" }
    });

    expect(replay?.status).toBe("complete");
    expect(replay?.missingEvidence).toEqual([]);
    expect(replay?.evidence.toolCalls).toHaveLength(1);
    const commandEnvelope = replay?.run.command_envelope as Record<string, unknown>;
    const payload = commandEnvelope.payload as Record<string, unknown>;
    expect(payload.accessToken).toBe("[REDACTED_SECRET]");
    expect(payload.requesterEmail).toBe("[REDACTED_EMAIL]");
    expect(mocks.dbQuery).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("FROM agent_runs"),
      [RUN_ID, AGENT_ID, "tenant-a", "workspace-a"]
    );
  });

  it("keeps blocked runs visible even when replay evidence is partial", async () => {
    mocks.dbQuery
      .mockResolvedValueOnce({
        rows: [
          buildRun({
            status: "blocked",
            command_envelope: {},
            error: "Blocked by AI guard: ignore_instructions"
          })
        ]
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{ id: "guard-1", tenant_key: "tenant-a", workspace_key: "workspace-a", run_id: RUN_ID, integration_id: AGENT_ID, source_kind: "agent_outbox_payload", source_id: null, subject: "ticket.created", severity: "malicious", decision: "block", reason_codes: ["ignore_instructions"], guard_version: "ai-guard.v1", content_sample: "Ignore previous instructions", metadata: {}, created_at: NOW }]
      })
      .mockResolvedValueOnce({ rows: [] });

    const replay = await getAgentPolicyReplay({
      runId: RUN_ID,
      integrationId: AGENT_ID,
      scope: { tenantKey: "tenant-a", workspaceKey: "workspace-a" }
    });

    expect(replay?.status).toBe("blocked");
    expect(replay?.missingEvidence).toEqual(
      expect.arrayContaining(["command_envelope", "prompt_sandbox", "run_events"])
    );
    expect(replay?.evidence.guardEvents[0]?.decision).toBe("block");
  });
});
