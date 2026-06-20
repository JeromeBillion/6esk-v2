import { beforeEach, describe, expect, it, vi } from "vitest";

const DEFAULT_TENANT_ID = "00000000-0000-0000-0000-000000000001";
const RUN_ID = "22222222-2222-4222-8222-222222222222";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  getAgentIntegrationById: vi.fn(),
  cancelAgentRun: vi.fn(),
  recordAuditLog: vi.fn(),
  runInBackground: vi.fn()
}));

vi.mock("@/server/auth/session", () => ({
  getSessionUser: mocks.getSessionUser
}));

vi.mock("@/server/agents/integrations", () => ({
  getAgentIntegrationById: mocks.getAgentIntegrationById
}));

vi.mock("@/server/agents/run-ledger", () => ({
  cancelAgentRun: mocks.cancelAgentRun
}));

vi.mock("@/server/audit", () => ({
  recordAuditLog: mocks.recordAuditLog
}));

vi.mock("@/server/async", () => ({
  runInBackground: mocks.runInBackground
}));

import { POST } from "@/app/api/admin/agents/[agentId]/runs/[runId]/cancel/route";

function buildUser(roleName: "lead_admin" | "agent", tenantId = DEFAULT_TENANT_ID) {
  return {
    id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    email: `${roleName}@6ex.co.za`,
    display_name: roleName,
    role_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    role_name: roleName,
    tenant_id: tenantId
  };
}

function request(body?: Record<string, unknown>) {
  return new Request(`http://localhost/api/admin/agents/agent-1/runs/${RUN_ID}/cancel`, {
    method: "POST",
    body: body ? JSON.stringify(body) : undefined
  });
}

describe("POST /api/admin/agents/[agentId]/runs/[runId]/cancel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSessionUser.mockResolvedValue(buildUser("lead_admin"));
    mocks.getAgentIntegrationById.mockResolvedValue({ id: "agent-1", status: "active" });
    mocks.cancelAgentRun.mockResolvedValue({
      cancelled: true,
      reason: "cancelled",
      runId: RUN_ID,
      previousStatus: "running",
      cancelledSteps: 2,
      cancelledToolCalls: 1,
      cancelledOutboxEvents: 1
    });
    mocks.recordAuditLog.mockResolvedValue(undefined);
  });

  it("returns 403 for non-admin users", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser("agent"));

    const response = await POST(
      request(),
      { params: Promise.resolve({ agentId: "agent-1", runId: RUN_ID }) }
    );

    expect(response.status).toBe(403);
    expect(mocks.getAgentIntegrationById).not.toHaveBeenCalled();
    expect(mocks.cancelAgentRun).not.toHaveBeenCalled();
  });

  it("returns 403 for admin sessions without tenant scope", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser("lead_admin", ""));

    const response = await POST(
      request(),
      { params: Promise.resolve({ agentId: "agent-1", runId: RUN_ID }) }
    );

    expect(response.status).toBe(403);
    expect(mocks.getAgentIntegrationById).not.toHaveBeenCalled();
    expect(mocks.cancelAgentRun).not.toHaveBeenCalled();
  });

  it("cancels tenant-scoped runs and records audit evidence", async () => {
    const response = await POST(
      request({ reason: "Rollback before rollout." }),
      { params: Promise.resolve({ agentId: "agent-1", runId: RUN_ID }) }
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      status: "ok",
      cancelled: true,
      previousStatus: "running",
      cancelledOutboxEvents: 1
    });
    expect(mocks.getAgentIntegrationById).toHaveBeenCalledWith("agent-1", DEFAULT_TENANT_ID);
    expect(mocks.cancelAgentRun).toHaveBeenCalledWith({
      tenantId: DEFAULT_TENANT_ID,
      integrationId: "agent-1",
      runId: RUN_ID,
      reason: "Rollback before rollout.",
      actor: {
        type: "user",
        id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        displayName: "lead_admin"
      }
    });
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: DEFAULT_TENANT_ID,
        action: "agent_run_cancelled",
        entityType: "agent_run",
        entityId: RUN_ID,
        data: expect.objectContaining({
          agentId: "agent-1",
          previousStatus: "running",
          cancelledToolCalls: 1
        })
      })
    );
  });

  it("returns 404 when the run is outside the tenant integration", async () => {
    mocks.cancelAgentRun.mockResolvedValue({
      cancelled: false,
      reason: "not_found",
      runId: RUN_ID,
      cancelledSteps: 0,
      cancelledToolCalls: 0,
      cancelledOutboxEvents: 0
    });

    const response = await POST(
      request(),
      { params: Promise.resolve({ agentId: "agent-1", runId: RUN_ID }) }
    );

    expect(response.status).toBe(404);
  });

  it("rejects cancellation of terminal runs and records audit evidence", async () => {
    mocks.cancelAgentRun.mockResolvedValue({
      cancelled: false,
      reason: "not_cancellable",
      runId: RUN_ID,
      previousStatus: "completed",
      cancelledSteps: 0,
      cancelledToolCalls: 0,
      cancelledOutboxEvents: 0
    });

    const response = await POST(
      request({ reason: "Too late." }),
      { params: Promise.resolve({ agentId: "agent-1", runId: RUN_ID }) }
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toMatchObject({
      error: "Run is not cancellable",
      status: "completed"
    });
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "agent_run_cancel_rejected",
        tenantId: DEFAULT_TENANT_ID,
        entityId: RUN_ID,
        data: expect.objectContaining({
          previousStatus: "completed",
          reason: "Too late."
        })
      })
    );
  });
});
