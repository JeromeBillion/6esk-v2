import { beforeEach, describe, expect, it, vi } from "vitest";

const TENANT_ID = "00000000-0000-0000-0000-000000000001";
const INTEGRATION_ID = "11111111-1111-4111-8111-111111111111";
const OUTBOX_ID = "22222222-2222-4222-8222-222222222222";
const RUN_ID = "33333333-3333-4333-8333-333333333333";
const TICKET_ID = "44444444-4444-4444-8444-444444444444";

const mocks = vi.hoisted(() => ({
  db: {
    query: vi.fn()
  }
}));

vi.mock("@/server/db", () => ({
  db: mocks.db
}));

import {
  createAgentRunForOutbox,
  deriveAgentRunContext,
  markAgentRunCompleted,
  markAgentRunFailed,
  markAgentRunRunning
} from "@/server/agents/run-ledger";

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
    await markAgentRunRunning({ tenantId: TENANT_ID, runId: RUN_ID, attemptCount: 1 });
    await markAgentRunCompleted({ tenantId: TENANT_ID, runId: RUN_ID });
    await markAgentRunFailed({
      tenantId: TENANT_ID,
      runId: RUN_ID,
      errorMessage: "gateway timeout",
      terminal: false,
      attemptCount: 2
    });

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
});
