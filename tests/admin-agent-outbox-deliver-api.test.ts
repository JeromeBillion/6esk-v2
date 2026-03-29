import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  getAgentIntegrationById: vi.fn(),
  deliverPendingAgentEvents: vi.fn(),
  recordAuditLog: vi.fn()
}));

vi.mock("@/server/auth/session", () => ({
  getSessionUser: mocks.getSessionUser
}));

vi.mock("@/server/agents/integrations", () => ({
  getAgentIntegrationById: mocks.getAgentIntegrationById
}));

vi.mock("@/server/agents/outbox", () => ({
  deliverPendingAgentEvents: mocks.deliverPendingAgentEvents
}));

vi.mock("@/server/audit", () => ({
  recordAuditLog: mocks.recordAuditLog
}));

import { POST } from "@/app/api/admin/agents/[agentId]/outbox/deliver/route";

function buildUser(roleName: "lead_admin" | "agent") {
  return {
    id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    email: `${roleName}@6ex.co.za`,
    display_name: roleName,
    role_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    role_name: roleName
  };
}

describe("POST /api/admin/agents/[agentId]/outbox/deliver", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAgentIntegrationById.mockResolvedValue({ id: "agent-1", status: "active" });
    mocks.deliverPendingAgentEvents.mockResolvedValue({
      delivered: 2,
      skipped: 0,
      limitUsed: 10
    });
    mocks.recordAuditLog.mockResolvedValue(undefined);
  });

  it("returns 403 for non-admin users", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser("agent"));

    const response = await POST(new Request("http://localhost/api/admin/agents/agent-1/outbox/deliver", { method: "POST" }), {
      params: Promise.resolve({ agentId: "agent-1" })
    });
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toMatchObject({ error: "Forbidden" });
  });

  it("delivers agent outbox and records audit", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser("lead_admin"));

    const response = await POST(
      new Request("http://localhost/api/admin/agents/agent-1/outbox/deliver?limit=10", { method: "POST" }),
      { params: Promise.resolve({ agentId: "agent-1" }) }
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ status: "ok", delivered: 2, skipped: 0, limitUsed: 10 });
    expect(mocks.deliverPendingAgentEvents).toHaveBeenCalledWith({
      integrationId: "agent-1",
      limit: 10
    });
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "agent_outbox_delivery_triggered"
      })
    );
  });

  it("returns 500 and records failure audit when delivery throws", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser("lead_admin"));
    mocks.deliverPendingAgentEvents.mockRejectedValueOnce(new Error("hook down"));

    const response = await POST(
      new Request("http://localhost/api/admin/agents/agent-1/outbox/deliver?limit=10", { method: "POST" }),
      { params: Promise.resolve({ agentId: "agent-1" }) }
    );
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toMatchObject({
      error: "Failed to deliver agent outbox",
      detail: "hook down"
    });
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "agent_outbox_delivery_failed"
      })
    );
  });
});
