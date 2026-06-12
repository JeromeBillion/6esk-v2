import { beforeEach, describe, expect, it, vi } from "vitest";

const TENANT_ID = "00000000-0000-0000-0000-000000000001";
const INTEGRATION_ID = "11111111-1111-4111-8111-111111111111";
const OUTBOX_ID = "22222222-2222-4222-8222-222222222222";
const RUN_ID = "33333333-3333-4333-8333-333333333333";

const mocks = vi.hoisted(() => ({
  client: {
    query: vi.fn(),
    release: vi.fn()
  },
  db: {
    connect: vi.fn(),
    query: vi.fn()
  },
  getActiveAgentIntegration: vi.fn(),
  getAgentIntegrationById: vi.fn(),
  createAgentRunForOutbox: vi.fn(),
  markAgentRunRunning: vi.fn(),
  markAgentRunCompleted: vi.fn(),
  markAgentRunFailed: vi.fn(),
  recordAgentRunStepStarted: vi.fn(),
  completeAgentRunStep: vi.fn(),
  appendAgentRunEvent: vi.fn(),
  processInternalDexterMessage: vi.fn(),
  recordModuleUsageEvent: vi.fn(),
  logger: {
    warn: vi.fn(),
    error: vi.fn()
  }
}));

vi.mock("@/server/db", () => ({
  db: mocks.db
}));

vi.mock("@/server/agents/integrations", () => ({
  getActiveAgentIntegration: mocks.getActiveAgentIntegration,
  getAgentIntegrationById: mocks.getAgentIntegrationById
}));

vi.mock("@/server/agents/run-ledger", () => ({
  appendAgentRunEvent: mocks.appendAgentRunEvent,
  createAgentRunForOutbox: mocks.createAgentRunForOutbox,
  completeAgentRunStep: mocks.completeAgentRunStep,
  markAgentRunCompleted: mocks.markAgentRunCompleted,
  markAgentRunFailed: mocks.markAgentRunFailed,
  markAgentRunRunning: mocks.markAgentRunRunning,
  recordAgentRunStepStarted: mocks.recordAgentRunStepStarted
}));

vi.mock("@/server/dexter-runtime", () => ({
  processInternalDexterMessage: mocks.processInternalDexterMessage
}));

vi.mock("@/server/module-metering", () => ({
  recordModuleUsageEvent: mocks.recordModuleUsageEvent
}));

vi.mock("@/server/logger", () => ({
  logger: mocks.logger
}));

import { deliverPendingAgentEvents } from "@/server/agents/outbox";

function activeIntegration() {
  return {
    id: INTEGRATION_ID,
    tenant_id: TENANT_ID,
    name: "Dexter",
    provider: "elizaos",
    base_url: "internal://dexter",
    auth_type: "hmac",
    shared_secret: "secret",
    status: "active",
    policy_mode: "draft_only",
    scopes: {},
    capabilities: {},
    policy: {},
    created_at: "2026-05-14T09:00:00.000Z",
    updated_at: "2026-05-14T09:00:00.000Z"
  };
}

describe("agent outbox lane reservation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.AGENT_OUTBOX_LANE_RETRY_SECONDS;
    mocks.db.connect.mockResolvedValue(mocks.client);
    mocks.db.query.mockResolvedValue({ rows: [] });
    mocks.client.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: OUTBOX_ID,
            tenant_id: TENANT_ID,
            integration_id: INTEGRATION_ID,
            event_type: "ticket.message.created",
            payload: {
              tenant_id: TENANT_ID,
              resource: { ticket_id: "44444444-4444-4444-8444-444444444444" }
            },
            attempt_count: 0,
            run_id: RUN_ID
          }
        ]
      })
      .mockResolvedValueOnce({ rows: [] });
    mocks.getAgentIntegrationById.mockResolvedValue(activeIntegration());
    mocks.getActiveAgentIntegration.mockResolvedValue(activeIntegration());
    mocks.markAgentRunRunning.mockResolvedValue(false);
    mocks.recordAgentRunStepStarted.mockResolvedValue({
      tenantId: TENANT_ID,
      runId: RUN_ID,
      stepId: "55555555-5555-4555-8555-555555555555",
      stepType: "runtime:deliver_event"
    });
    mocks.completeAgentRunStep.mockResolvedValue(undefined);
    mocks.processInternalDexterMessage.mockResolvedValue(true);
  });

  it("releases a lane-busy event without posting to Dexter or consuming an attempt", async () => {
    const result = await deliverPendingAgentEvents({
      integrationId: INTEGRATION_ID,
      tenantId: TENANT_ID,
      limit: 5
    });

    expect(result).toEqual({ delivered: 0, skipped: 1, limitUsed: 5 });
    expect(mocks.markAgentRunRunning).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      runId: RUN_ID,
      attemptCount: 1
    });
    expect(mocks.processInternalDexterMessage).not.toHaveBeenCalled();
    expect(mocks.markAgentRunFailed).not.toHaveBeenCalled();
    expect(mocks.markAgentRunCompleted).not.toHaveBeenCalled();
    expect(mocks.recordAgentRunStepStarted).not.toHaveBeenCalled();
    expect(mocks.completeAgentRunStep).not.toHaveBeenCalled();
    expect(mocks.db.query).toHaveBeenCalledWith(
      expect.stringContaining("next_attempt_at = now() + make_interval"),
      [OUTBOX_ID, 10]
    );
  });
});
