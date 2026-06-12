import { beforeEach, describe, expect, it, vi } from "vitest";

const TENANT_ID = "00000000-0000-0000-0000-000000000001";
const INTEGRATION_ID = "11111111-1111-4111-8111-111111111111";
const OUTBOX_ID = "22222222-2222-4222-8222-222222222222";
const RUN_ID = "33333333-3333-4333-8333-333333333333";
const TICKET_ID = "44444444-4444-4444-8444-444444444444";
const TOOL_CALL_ID = "55555555-5555-4555-8555-555555555555";
const APPROVAL_ID = "66666666-6666-4666-8666-666666666666";
const BLOCKING_RUN_ID = "77777777-7777-4777-8777-777777777777";

const mocks = vi.hoisted(() => ({
  db: {
    query: vi.fn()
  }
}));

vi.mock("@/server/db", () => ({
  db: mocks.db
}));

import {
  appendAgentApprovalRequestedCommand,
  appendAgentToolRequestedCommand,
  createAgentRunForOutbox,
  deriveAgentRunContext,
  markAgentRunCompleted,
  markAgentRunFailed,
  markAgentRunRunning
} from "@/server/agents/run-ledger";

function runContext(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: RUN_ID,
    tenant_id: TENANT_ID,
    integration_id: INTEGRATION_ID,
    lane_key: `tenant:${TENANT_ID}:ticket:${TICKET_ID}`,
    source_channel: "ticket",
    resource_type: "ticket",
    resource_id: TICKET_ID,
    trigger_event_type: "ticket.message.created",
    trigger_outbox_id: OUTBOX_ID,
    requested_scopes: ["tickets:read"],
    rollout_mode: "hybrid_review",
    provider_mode: "managed",
    ...overrides
  };
}

describe("agent run ledger", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.db.query.mockResolvedValue({ rows: [] });
  });

  it("derives tenant/resource lane context from outbox payload", () => {
    const context = deriveAgentRunContext({
      tenantId: TENANT_ID,
      integrationId: INTEGRATION_ID,
      eventType: "ticket.message.created",
      payload: {
        idempotencyKey: "ticket-message-1",
        requestedScopes: ["tickets:read"],
        rolloutMode: "hybrid_review",
        providerMode: "managed",
        resource: {
          ticket_id: TICKET_ID
        }
      }
    });

    expect(context).toMatchObject({
      sourceChannel: "ticket",
      resourceType: "ticket",
      resourceId: TICKET_ID,
      idempotencyKey: "ticket-message-1",
      requestedScopes: ["tickets:read"],
      rolloutMode: "hybrid_review",
      providerMode: "managed",
      laneKey: `tenant:${TENANT_ID}:ticket:${TICKET_ID}`
    });
  });

  it("creates a queued run and initial event for an outbox event", async () => {
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [
            {
              id: RUN_ID,
              tenant_id: TENANT_ID,
              status: "queued",
              lane_key: `tenant:${TENANT_ID}:ticket:${TICKET_ID}`
            }
          ]
        })
        .mockResolvedValue({ rows: [] })
    };

    const run = await createAgentRunForOutbox({
      client,
      tenantId: TENANT_ID,
      integrationId: INTEGRATION_ID,
      outboxEventId: OUTBOX_ID,
      eventType: "ticket.message.created",
      payload: {
        resource: { ticket_id: TICKET_ID },
        requestedScopes: ["tickets:read"]
      }
    });

    expect(run.id).toBe(RUN_ID);
    expect(client.query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("INSERT INTO agent_runs"),
      expect.arrayContaining([
        TENANT_ID,
        INTEGRATION_ID,
        `tenant:${TENANT_ID}:ticket:${TICKET_ID}`,
        "ticket",
        "ticket",
        TICKET_ID,
        "ticket.message.created",
        OUTBOX_ID
      ])
    );
    expect(client.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("UPDATE agent_runs"),
      expect.arrayContaining([
        TENANT_ID,
        RUN_ID,
        `outbox:${OUTBOX_ID}`,
        JSON.stringify(["tickets:read"]),
        "draft_only",
        "managed"
      ])
    );
    expect(client.query).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining("UPDATE agent_outbox"),
      [TENANT_ID, OUTBOX_ID, RUN_ID]
    );
    expect(client.query).toHaveBeenNthCalledWith(
      4,
      expect.stringContaining("INSERT INTO agent_run_events"),
      expect.arrayContaining([
        TENANT_ID,
        RUN_ID,
        "agent.run.queued",
        "queued"
      ])
    );
    const eventData = JSON.parse(client.query.mock.calls[3][1][5]);
    expect(eventData.commandEnvelope).toMatchObject({
      protocol: "6esk.dexter.control-plane",
      command: "agent.run.create",
      tenantId: TENANT_ID,
      runId: RUN_ID,
      idempotencyKey: `outbox:${OUTBOX_ID}`,
      source: {
        channel: "ticket",
        triggerEventType: "ticket.message.created",
        outboxEventId: OUTBOX_ID
      },
      resourceRefs: [{ type: "ticket", id: TICKET_ID }],
      requestedScopes: ["tickets:read"],
      rolloutMode: "draft_only",
      providerMode: "managed",
      laneKey: `tenant:${TENANT_ID}:ticket:${TICKET_ID}`
    });
  });

  it("records running, completed, and retryable failure events", async () => {
    mocks.db.query
      .mockResolvedValueOnce({
        rows: [
          {
            reserved: true,
            id: RUN_ID,
            lane_key: `tenant:${TENANT_ID}:ticket:${TICKET_ID}`,
            blocked_by_run_id: null
          }
        ]
      })
      .mockResolvedValue({ rows: [] });

    const reserved = await markAgentRunRunning({ tenantId: TENANT_ID, runId: RUN_ID, attemptCount: 1 });
    await markAgentRunCompleted({ tenantId: TENANT_ID, runId: RUN_ID });
    await markAgentRunFailed({
      tenantId: TENANT_ID,
      runId: RUN_ID,
      errorMessage: "gateway timeout",
      terminal: false,
      attemptCount: 2
    });

    expect(reserved).toBe(true);
    expect(mocks.db.query).toHaveBeenCalledWith(
      expect.stringContaining("SET status = 'running'"),
      [TENANT_ID, RUN_ID]
    );
    expect(mocks.db.query).toHaveBeenCalledWith(
      expect.stringContaining("SET status = 'completed'"),
      [TENANT_ID, RUN_ID]
    );
    expect(mocks.db.query).toHaveBeenCalledWith(
      expect.stringContaining("SET status = $3"),
      [TENANT_ID, RUN_ID, "queued", false, "gateway timeout"]
    );
    expect(mocks.db.query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO agent_run_events"),
      expect.arrayContaining([TENANT_ID, RUN_ID, "agent.run.retry_queued", "queued"])
    );
  });

  it("reserves a tenant lane atomically before running a Dexter run", async () => {
    mocks.db.query
      .mockResolvedValueOnce({
        rows: [
          {
            reserved: true,
            id: RUN_ID,
            lane_key: `tenant:${TENANT_ID}:ticket:${TICKET_ID}`,
            blocked_by_run_id: null
          }
        ]
      })
      .mockResolvedValueOnce({ rows: [] });

    const reserved = await markAgentRunRunning({ tenantId: TENANT_ID, runId: RUN_ID, attemptCount: 1 });

    expect(reserved).toBe(true);
    expect(mocks.db.query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("pg_advisory_xact_lock"),
      [TENANT_ID, RUN_ID]
    );
    expect(mocks.db.query.mock.calls[0][0]).toContain("other.status IN ('running', 'waiting_approval')");
    expect(mocks.db.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("INSERT INTO agent_run_events"),
      expect.arrayContaining([TENANT_ID, RUN_ID, "agent.run.running", "running"])
    );
  });

  it("keeps a run queued when another run owns the same lane", async () => {
    mocks.db.query
      .mockResolvedValueOnce({
        rows: [
          {
            reserved: false,
            id: RUN_ID,
            lane_key: `tenant:${TENANT_ID}:ticket:${TICKET_ID}`,
            blocked_by_run_id: BLOCKING_RUN_ID
          }
        ]
      })
      .mockResolvedValueOnce({ rows: [runContext()] })
      .mockResolvedValueOnce({ rows: [] });

    const reserved = await markAgentRunRunning({ tenantId: TENANT_ID, runId: RUN_ID, attemptCount: 2 });

    expect(reserved).toBe(false);
    expect(mocks.db.query).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining("INSERT INTO agent_run_events"),
      expect.arrayContaining([TENANT_ID, RUN_ID, "agent.run.lane_wait", "queued"])
    );
    const eventData = JSON.parse(mocks.db.query.mock.calls[2][1][5]);
    expect(eventData.commandEnvelope).toMatchObject({
      command: "agent.wait",
      commandData: {
        waitReason: "lane_busy",
        metadata: {
          attemptCount: 2,
          blockedByRunId: BLOCKING_RUN_ID,
          laneKey: `tenant:${TENANT_ID}:ticket:${TICKET_ID}`
        }
      }
    });
  });

  it("records a typed run-completed command envelope in the timeline", async () => {
    mocks.db.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [runContext()] })
      .mockResolvedValueOnce({ rows: [] });

    await markAgentRunCompleted({ tenantId: TENANT_ID, runId: RUN_ID });

    expect(mocks.db.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("FROM agent_runs"),
      [TENANT_ID, RUN_ID]
    );
    expect(mocks.db.query).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining("INSERT INTO agent_run_events"),
      expect.arrayContaining([TENANT_ID, RUN_ID, "agent.run.completed", "completed"])
    );
    const eventData = JSON.parse(mocks.db.query.mock.calls[2][1][5]);
    expect(eventData.commandEnvelope).toMatchObject({
      protocol: "6esk.dexter.control-plane",
      command: "agent.run.completed",
      tenantId: TENANT_ID,
      runId: RUN_ID,
      resourceRefs: [{ type: "ticket", id: TICKET_ID }],
      rolloutMode: "hybrid_review",
      providerMode: "managed",
      commandData: {
        completionStatus: "completed"
      }
    });
  });

  it("records typed tool and approval control-plane envelopes", async () => {
    mocks.db.query
      .mockResolvedValueOnce({ rows: [runContext({ rollout_mode: "full_auto" })] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [runContext()] })
      .mockResolvedValueOnce({ rows: [] });

    await appendAgentToolRequestedCommand({
      tenantId: TENANT_ID,
      runId: RUN_ID,
      actor: { type: "agent", id: INTEGRATION_ID },
      toolName: "send_reply",
      toolCallId: TOOL_CALL_ID,
      requestedScopes: ["tickets:write", "email:send"],
      idempotencyKey: "tool:send-reply:1",
      metadata: { toolClass: "external_send" }
    });

    await appendAgentApprovalRequestedCommand({
      tenantId: TENANT_ID,
      runId: RUN_ID,
      actor: { type: "agent", id: INTEGRATION_ID },
      approvalId: APPROVAL_ID,
      reason: "Hybrid review required for customer-visible reply"
    });

    const toolEventData = JSON.parse(mocks.db.query.mock.calls[1][1][5]);
    expect(toolEventData.commandEnvelope).toMatchObject({
      command: "agent.tool.requested",
      idempotencyKey: "tool:send-reply:1",
      requestedScopes: ["tickets:write", "email:send"],
      rolloutMode: "full_auto",
      commandData: {
        toolName: "send_reply",
        toolCallId: TOOL_CALL_ID,
        metadata: {
          toolClass: "external_send"
        }
      }
    });

    const approvalEventData = JSON.parse(mocks.db.query.mock.calls[3][1][5]);
    expect(approvalEventData.commandEnvelope).toMatchObject({
      command: "agent.approval.requested",
      rolloutMode: "hybrid_review",
      commandData: {
        approvalId: APPROVAL_ID,
        reason: "Hybrid review required for customer-visible reply"
      }
    });
  });
});
