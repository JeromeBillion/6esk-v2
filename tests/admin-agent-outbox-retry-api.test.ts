import { beforeEach, describe, expect, it, vi } from "vitest";

const DEFAULT_TENANT_ID = "00000000-0000-0000-0000-000000000001";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  getAgentIntegrationById: vi.fn(),
  retryFailedAgentEvents: vi.fn(),
  recordAuditLog: vi.fn()
}));

vi.mock("@/server/auth/session", () => ({
  getSessionUser: mocks.getSessionUser
}));

vi.mock("@/server/agents/integrations", () => ({
  getAgentIntegrationById: mocks.getAgentIntegrationById
}));

vi.mock("@/server/agents/outbox", () => ({
  retryFailedAgentEvents: mocks.retryFailedAgentEvents
}));

vi.mock("@/server/audit", () => ({
  recordAuditLog: mocks.recordAuditLog
}));

import { POST } from "@/app/api/admin/agents/[agentId]/outbox/retry/route";

function buildUser(roleName: "lead_admin" | "agent") {
  return {
    id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    email: `${roleName}@6ex.co.za`,
    display_name: roleName,
    role_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    role_name: roleName
  };
}

describe("POST /api/admin/agents/[agentId]/outbox/retry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAgentIntegrationById.mockResolvedValue({ id: "agent-1", status: "active" });
    mocks.retryFailedAgentEvents.mockResolvedValue({
      requested: 10,
      retried: 2,
      ids: ["evt-1", "evt-2"]
    });
    mocks.recordAuditLog.mockResolvedValue(undefined);
  });

  it("returns 403 for non-admin users", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser("agent"));

    const response = await POST(new Request("http://localhost/api/admin/agents/agent-1/outbox/retry", { method: "POST" }), {
      params: Promise.resolve({ agentId: "agent-1" })
    });
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toMatchObject({ error: "Forbidden" });
  });

  it("retries failed agent events for admins", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser("lead_admin"));

    const response = await POST(
      new Request("http://localhost/api/admin/agents/agent-1/outbox/retry?limit=10", { method: "POST" }),
      { params: Promise.resolve({ agentId: "agent-1" }) }
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ status: "ok", retried: 2 });
    expect(mocks.retryFailedAgentEvents).toHaveBeenCalledWith({
      integrationId: "agent-1",
      tenantId: DEFAULT_TENANT_ID,
      limit: 10,
      eventIds: []
    });
  });

  it("returns 500 and records failure audit when retry execution throws", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser("lead_admin"));
    mocks.retryFailedAgentEvents.mockRejectedValueOnce(new Error("hook timeout"));

    const response = await POST(
      new Request("http://localhost/api/admin/agents/agent-1/outbox/retry?limit=10", { method: "POST" }),
      { params: Promise.resolve({ agentId: "agent-1" }) }
    );
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toMatchObject({
      error: "Failed to retry failed agent outbox events",
      detail: "hook timeout"
    });
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "agent_outbox_retry_failed"
      })
    );
  });
});
