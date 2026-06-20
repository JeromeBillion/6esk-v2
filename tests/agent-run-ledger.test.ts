import { beforeEach, describe, expect, it, vi } from "vitest";

const TENANT_ID = "00000000-0000-0000-0000-000000000001";
const INTEGRATION_ID = "11111111-1111-4111-8111-111111111111";
const OUTBOX_ID = "22222222-2222-4222-8222-222222222222";
const RUN_ID = "33333333-3333-4333-8333-333333333333";
const TICKET_ID = "44444444-4444-4444-8444-444444444444";
const TOOL_CALL_ID = "55555555-5555-4555-8555-555555555555";
const STEP_ID = "99999999-9999-4999-8999-999999999999";
const APPROVAL_ID = "66666666-6666-4666-8666-666666666666";
const BLOCKING_RUN_ID = "77777777-7777-4777-8777-777777777777";

const mocks = vi.hoisted(() => ({
  client: {
    query: vi.fn(),
    release: vi.fn()
  },
  db: {
    connect: vi.fn(),
    query: vi.fn()
  }
}));

vi.mock("@/server/db", () => ({
  db: mocks.db
}));

import {
  appendAgentApprovalRequestedCommand,
  appendAgentToolRequestedCommand,
  cancelAgentRun,
  completeAgentRunStep,
  completeAgentToolCall,
  createAgentRunForOutbox,
  deriveAgentRunContext,
  listRecentAgentRuns,
  markAgentRunCompleted,
  markAgentRunFailed,
  markAgentRunRunning,
  recordAgentRunStepStarted,
  recordAgentToolCallDenied,
  recordAgentToolCallRequested,
  recoverStaleAgentRuns
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
    mocks.db.connect.mockResolvedValue(mocks.client);
    mocks.db.query.mockResolvedValue({ rows: [] });
    mocks.client.query.mockResolvedValue({ rows: [] });
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

  it("populates durable step and tool-call ledgers for requested and completed tools", async () => {
    mocks.client.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: STEP_ID }] })
      .mockResolvedValueOnce({ rows: [{ id: TOOL_CALL_ID }] })
      .mockResolvedValueOnce({ rows: [runContext()] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [runContext()] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValue({ rows: [] });

    const ledger = await recordAgentToolCallRequested({
      tenantId: TENANT_ID,
      runId: RUN_ID,
      actor: { type: "agent", id: INTEGRATION_ID },
      toolName: "send_reply",
      requestedScopes: ["tickets:write", "customer_contact:send"],
      argsSummary: { actionType: "send_reply", ticketId: TICKET_ID, hasText: true },
      idempotencyKey: "idem-1",
      metadata: { toolClass: "external_send" }
    });

    await completeAgentToolCall({
      ledger,
      status: "completed",
      resultSummary: { status: "sent" }
    });

    expect(ledger).toEqual({
      tenantId: TENANT_ID,
      runId: RUN_ID,
      stepId: STEP_ID,
      toolCallId: TOOL_CALL_ID,
      toolName: "send_reply"
    });
    expect(mocks.client.query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO agent_run_steps"),
      expect.arrayContaining([TENANT_ID, RUN_ID, "tool:send_reply"])
    );
    expect(mocks.client.query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO agent_tool_calls"),
      expect.arrayContaining([TENANT_ID, RUN_ID, STEP_ID, "send_reply"])
    );
    expect(mocks.client.query).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE agent_tool_calls"),
      expect.arrayContaining([TENANT_ID, TOOL_CALL_ID, "completed"])
    );
    expect(mocks.client.query).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE agent_run_steps"),
      expect.arrayContaining([TENANT_ID, STEP_ID, "completed"])
    );
    const requestedEventData = JSON.parse(mocks.client.query.mock.calls[4][1][5]);
    expect(requestedEventData.commandEnvelope).toMatchObject({
      command: "agent.tool.requested",
      commandData: {
        toolName: "send_reply",
        toolCallId: TOOL_CALL_ID
      }
    });
    const completedEventData = JSON.parse(mocks.client.query.mock.calls[10][1][5]);
    expect(completedEventData.commandEnvelope).toMatchObject({
      command: "agent.tool.completed",
      commandData: {
        toolName: "send_reply",
        toolCallId: TOOL_CALL_ID,
        resultSummary: { status: "sent" }
      }
    });
  });

  it("records generic worker run steps for runtime dispatch phases", async () => {
    mocks.client.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: STEP_ID }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const ledger = await recordAgentRunStepStarted({
      tenantId: TENANT_ID,
      runId: RUN_ID,
      stepType: "runtime:deliver_event",
      summary: "Dexter runtime event delivery started",
      metadata: {
        outboxEventId: OUTBOX_ID,
        eventType: "ticket.message.created"
      }
    });

    await completeAgentRunStep({
      ledger,
      status: "completed",
      resultSummary: {
        outboxEventId: OUTBOX_ID,
        delivered: true
      }
    });

    expect(ledger).toEqual({
      tenantId: TENANT_ID,
      runId: RUN_ID,
      stepId: STEP_ID,
      stepType: "runtime:deliver_event"
    });
    expect(mocks.client.query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO agent_run_steps"),
      expect.arrayContaining([TENANT_ID, RUN_ID, "runtime:deliver_event"])
    );
    expect(mocks.client.query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO agent_run_events"),
      expect.arrayContaining([TENANT_ID, RUN_ID, "agent.step.started", "running"])
    );
    expect(mocks.client.query).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE agent_run_steps"),
      expect.arrayContaining([TENANT_ID, STEP_ID, "completed"])
    );
    expect(mocks.client.query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO agent_run_events"),
      expect.arrayContaining([TENANT_ID, RUN_ID, "agent.step.completed", "running"])
    );
  });

  it("records denied tool calls without executing a tool", async () => {
    mocks.client.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: STEP_ID }] })
      .mockResolvedValueOnce({ rows: [{ id: TOOL_CALL_ID }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    await recordAgentToolCallDenied({
      tenantId: TENANT_ID,
      runId: RUN_ID,
      toolName: "merge_customers",
      requestedScopes: ["customers:merge"],
      argsSummary: { actionType: "merge_customers", confidence: 0.4 },
      idempotencyKey: "idem-denied",
      reason: "Confidence below tenant threshold.",
      metadata: { policyDecision: "rollout_blocked" }
    });

    expect(mocks.client.query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO agent_run_steps"),
      expect.arrayContaining([TENANT_ID, RUN_ID, "tool:merge_customers", "Agent tool denied: merge_customers"])
    );
    expect(mocks.client.query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO agent_tool_calls"),
      expect.arrayContaining([TENANT_ID, RUN_ID, STEP_ID, "merge_customers"])
    );
    expect(mocks.client.query.mock.calls[2][1]).toContain("Confidence below tenant threshold.");
    expect(mocks.client.query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO agent_run_events"),
      expect.arrayContaining([TENANT_ID, RUN_ID, "agent.tool.denied", "running"])
    );
  });

  it("recovers stale active runs with retry and dead-letter evidence", async () => {
    mocks.client.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: RUN_ID,
            tenant_id: TENANT_ID,
            integration_id: INTEGRATION_ID,
            previous_status: "running",
            recovered_status: "timed_out",
            lane_key: `tenant:${TENANT_ID}:ticket:${TICKET_ID}`,
            trigger_outbox_id: OUTBOX_ID,
            previous_outbox_status: "processing",
            recovered_outbox_status: "pending",
            previous_attempt_count: 1,
            recovered_attempt_count: 2,
            outbox_recovery_action: "retry_queued"
          },
          {
            id: BLOCKING_RUN_ID,
            tenant_id: TENANT_ID,
            integration_id: INTEGRATION_ID,
            previous_status: "waiting_approval",
            recovered_status: "lost",
            lane_key: `tenant:${TENANT_ID}:ticket:${TICKET_ID}`,
            trigger_outbox_id: "88888888-8888-4888-8888-888888888888",
            previous_outbox_status: "processing",
            recovered_outbox_status: "failed",
            previous_attempt_count: 4,
            recovered_attempt_count: 5,
            outbox_recovery_action: "dead_lettered"
          }
        ]
      })
      .mockResolvedValueOnce({ rows: [runContext()] })
      .mockResolvedValue({ rows: [] });

    const result = await recoverStaleAgentRuns({
      tenantId: TENANT_ID,
      integrationId: INTEGRATION_ID,
      runningStaleSeconds: 60,
      approvalStaleSeconds: 3600,
      limit: 10,
      maxOutboxAttempts: 5
    });

    expect(result).toMatchObject({
      recovered: 2,
      retryQueued: 1,
      deadLettered: 1,
      timedOut: 1,
      lost: 1
    });
    expect(mocks.client.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("FOR UPDATE OF r SKIP LOCKED"),
      [
        TENANT_ID,
        INTEGRATION_ID,
        60,
        3600,
        10,
        5,
        "Recovered stale Dexter run after active-state timeout."
      ]
    );
    expect(mocks.client.query.mock.calls[1][0]).toContain("run_id = CASE");
    expect(mocks.client.query.mock.calls[1][0]).toContain("'dead_lettered'");
    expect(mocks.client.query).toHaveBeenCalledWith("COMMIT");

    const timeoutEventData = JSON.parse(mocks.client.query.mock.calls[3][1][5]);
    expect(timeoutEventData.commandEnvelope).toMatchObject({
      command: "agent.run.completed",
      commandData: {
        completionStatus: "timed_out",
        metadata: {
          outboxRecoveryAction: "retry_queued",
          recoveredOutboxStatus: "pending"
        }
      }
    });
    const lostEventData = JSON.parse(mocks.client.query.mock.calls[4][1][5]);
    expect(lostEventData).toMatchObject({
      outboxRecoveryAction: "dead_lettered",
      recoveredOutboxStatus: "failed"
    });
  });

  it("cancels active runs with ledger, tool, step, and outbox evidence", async () => {
    mocks.client.query.mockImplementation((queryText: unknown) => {
      const sql = String(queryText);
      if (sql.includes("SELECT id, status") && sql.includes("FOR UPDATE")) {
        return Promise.resolve({ rows: [{ id: RUN_ID, status: "running" }] });
      }
      if (sql.includes("cancelled_steps")) {
        return Promise.resolve({ rows: [{ cancelled_steps: 2 }] });
      }
      if (sql.includes("cancelled_tool_calls")) {
        return Promise.resolve({ rows: [{ cancelled_tool_calls: 1 }] });
      }
      if (sql.includes("cancelled_outbox_events")) {
        return Promise.resolve({ rows: [{ cancelled_outbox_events: 1 }] });
      }
      if (sql.includes("trigger_outbox_id") && sql.includes("FROM agent_runs")) {
        return Promise.resolve({ rows: [runContext()] });
      }
      return Promise.resolve({ rows: [] });
    });

    const result = await cancelAgentRun({
      tenantId: TENANT_ID,
      integrationId: INTEGRATION_ID,
      runId: RUN_ID,
      reason: "Operator rollback.",
      actor: {
        type: "user",
        id: "operator-1",
        displayName: "Lead Admin"
      }
    });

    expect(result).toMatchObject({
      cancelled: true,
      reason: "cancelled",
      previousStatus: "running",
      cancelledSteps: 2,
      cancelledToolCalls: 1,
      cancelledOutboxEvents: 1
    });

    const queries = mocks.client.query.mock.calls.map((call) => String(call[0]));
    expect(queries.some((sql) => sql.includes("UPDATE agent_runs") && sql.includes("cancelled_at = now()"))).toBe(true);
    expect(queries.some((sql) => sql.includes("UPDATE agent_run_steps") && sql.includes("status = 'cancelled'"))).toBe(true);
    expect(queries.some((sql) => sql.includes("UPDATE agent_tool_calls") && sql.includes("status = 'cancelled'"))).toBe(true);
    expect(queries.some((sql) => sql.includes("UPDATE agent_outbox") && sql.includes("status = 'failed'"))).toBe(true);

    const eventCall = mocks.client.query.mock.calls.find((call) =>
      String(call[0]).includes("INSERT INTO agent_run_events")
    );
    expect(eventCall?.[1]).toEqual(expect.arrayContaining([
      TENANT_ID,
      RUN_ID,
      "agent.run.cancel",
      "cancelled",
      "Agent run cancellation requested"
    ]));
    const eventData = JSON.parse((eventCall?.[1] as unknown[])[5] as string);
    expect(eventData.commandEnvelope).toMatchObject({
      command: "agent.run.cancel",
      actor: {
        type: "user",
        id: "operator-1"
      },
      commandData: {
        reason: "Operator rollback."
      }
    });
    expect(mocks.client.query).toHaveBeenCalledWith("COMMIT");
  });

  it("lists recent runs with tenant, integration, and status filters", async () => {
    mocks.db.query.mockResolvedValueOnce({ rows: [{ id: RUN_ID, status: "running" }] });

    const rows = await listRecentAgentRuns({
      tenantId: TENANT_ID,
      integrationId: INTEGRATION_ID,
      statuses: ["running", "waiting_approval"],
      limit: 500
    });

    expect(rows).toEqual([{ id: RUN_ID, status: "running" }]);
    expect(mocks.db.query).toHaveBeenCalledWith(
      expect.stringContaining("status = ANY($4::text[])"),
      [TENANT_ID, INTEGRATION_ID, 100, ["running", "waiting_approval"]]
    );
  });
});
