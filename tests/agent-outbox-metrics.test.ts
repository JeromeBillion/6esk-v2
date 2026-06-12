import { beforeEach, describe, expect, it, vi } from "vitest";

const TENANT_ID = "00000000-0000-0000-0000-000000000001";
const INTEGRATION_ID = "11111111-1111-4111-8111-111111111111";

const mocks = vi.hoisted(() => ({
  db: {
    query: vi.fn()
  },
  getAgentIntegrationById: vi.fn()
}));

vi.mock("@/server/db", () => ({
  db: mocks.db
}));

vi.mock("@/server/agents/integrations", () => ({
  getAgentIntegrationById: mocks.getAgentIntegrationById
}));

import { getAgentOutboxMetrics } from "@/server/agents/outbox-metrics";

describe("agent outbox metrics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAgentIntegrationById.mockResolvedValue({
      id: INTEGRATION_ID,
      tenant_id: TENANT_ID,
      status: "active",
      capabilities: { max_events_per_run: 25 }
    });
  });

  it("returns queue, run, and lane diagnostics for an agent", async () => {
    mocks.db.query
      .mockResolvedValueOnce({
        rows: [
          {
            pending: 5,
            due_now: 2,
            processing: 1,
            failed: 1,
            delivered_total: 12,
            delivered_24h: 3,
            next_attempt_at: new Date("2026-06-01T10:00:00.000Z"),
            last_delivered_at: new Date("2026-06-01T09:30:00.000Z"),
            last_failed_at: new Date("2026-06-01T09:00:00.000Z")
          }
        ]
      })
      .mockResolvedValueOnce({ rows: [{ last_error: "gateway timeout" }] })
      .mockResolvedValueOnce({
        rows: [
          {
            queued: 4,
            running: 1,
            waiting_approval: 1,
            timed_out: 2,
            lost: 1,
            failed: 1,
            stale_active: 1,
            oldest_queued_at: new Date("2026-06-01T08:00:00.000Z"),
            oldest_active_at: new Date("2026-06-01T08:30:00.000Z")
          }
        ]
      })
      .mockResolvedValueOnce({
        rows: [
          {
            lane_key: `tenant:${TENANT_ID}:ticket:22222222-2222-4222-8222-222222222222`,
            queued: 3,
            running: 1,
            waiting_approval: 0,
            stale_active: 1,
            oldest_queued_at: new Date("2026-06-01T08:00:00.000Z"),
            oldest_active_at: new Date("2026-06-01T08:30:00.000Z"),
            oldest_wait_seconds: 900
          }
        ]
      })
      .mockResolvedValueOnce({
        rows: [
          {
            requested: 0,
            approved: 0,
            denied: 2,
            running: 1,
            completed: 8,
            failed: 1,
            cancelled: 0,
            last_denied_at: new Date("2026-06-01T08:45:00.000Z"),
            last_failed_at: new Date("2026-06-01T08:50:00.000Z")
          }
        ]
      });

    const metrics = await getAgentOutboxMetrics(INTEGRATION_ID, 10, TENANT_ID);

    expect(metrics).toMatchObject({
      integrationId: INTEGRATION_ID,
      queue: {
        pending: 5,
        dueNow: 2,
        processing: 1,
        failed: 1,
        lastError: "gateway timeout"
      },
      runs: {
        queued: 4,
        running: 1,
        waitingApproval: 1,
        staleActive: 1,
        staleAfterSeconds: 900
      },
      lanes: {
        top: [
          {
            queued: 3,
            running: 1,
            staleActive: 1,
            oldestWaitSeconds: 900
          }
        ]
      },
      toolCalls: {
        denied: 2,
        running: 1,
        completed: 8,
        failed: 1,
        lastDeniedAt: "2026-06-01T08:45:00.000Z",
        lastFailedAt: "2026-06-01T08:50:00.000Z"
      }
    });
    expect(mocks.db.query).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining("FROM agent_runs"),
      [TENANT_ID, INTEGRATION_ID, 900]
    );
    expect(mocks.db.query).toHaveBeenNthCalledWith(
      4,
      expect.stringContaining("GROUP BY lane_key"),
      [TENANT_ID, INTEGRATION_ID, 900]
    );
    expect(mocks.db.query).toHaveBeenNthCalledWith(
      5,
      expect.stringContaining("FROM agent_tool_calls"),
      [TENANT_ID, INTEGRATION_ID]
    );
  });
});
