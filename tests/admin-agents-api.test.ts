import { beforeEach, describe, expect, it, vi } from "vitest";

const TENANT_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  listAgentIntegrations: vi.fn(),
  getAgentIntegrationById: vi.fn(),
  getAgentOutboxMetrics: vi.fn()
}));

vi.mock("@/server/auth/session", () => ({
  getSessionUser: mocks.getSessionUser
}));

vi.mock("@/server/agents/integrations", () => ({
  listAgentIntegrations: mocks.listAgentIntegrations,
  getAgentIntegrationById: mocks.getAgentIntegrationById,
  createAgentIntegration: vi.fn(),
  updateAgentIntegration: vi.fn()
}));

vi.mock("@/server/agents/outbox-metrics", () => ({
  getAgentOutboxMetrics: mocks.getAgentOutboxMetrics
}));

vi.mock("@/server/audit", () => ({
  recordAuditLog: vi.fn()
}));

import { GET as listAgents } from "@/app/api/admin/agents/route";
import { GET as getAgent } from "@/app/api/admin/agents/[agentId]/route";
import { GET as getAgentOutbox } from "@/app/api/admin/agents/[agentId]/outbox/route";

function buildUser(tenantId = TENANT_ID) {
  return {
    id: "user-1",
    email: "admin@example.com",
    display_name: "Admin",
    role_id: "role-1",
    role_name: "lead_admin",
    tenant_id: tenantId
  };
}

describe("admin agent tenant scope", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSessionUser.mockResolvedValue(buildUser());
    mocks.listAgentIntegrations.mockResolvedValue([{ id: "agent-1" }]);
    mocks.getAgentIntegrationById.mockResolvedValue({ id: "agent-1", status: "active" });
    mocks.getAgentOutboxMetrics.mockResolvedValue({ integrationId: "agent-1", queued: 0 });
  });

  it("blocks lead-admin agent list access without tenant scope", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser(""));

    const response = await listAgents();

    expect(response.status).toBe(403);
    expect(mocks.listAgentIntegrations).not.toHaveBeenCalled();
  });

  it("lists agents inside the admin tenant scope", async () => {
    const response = await listAgents();

    expect(response.status).toBe(200);
    expect(mocks.listAgentIntegrations).toHaveBeenCalledWith(TENANT_ID);
  });

  it("loads an agent by id inside the admin tenant scope", async () => {
    const response = await getAgent(new Request("http://localhost/api/admin/agents/agent-1"), {
      params: Promise.resolve({ agentId: "agent-1" })
    });

    expect(response.status).toBe(200);
    expect(mocks.getAgentIntegrationById).toHaveBeenCalledWith("agent-1", TENANT_ID);
  });

  it("loads outbox metrics inside the admin tenant scope", async () => {
    const response = await getAgentOutbox(
      new Request("http://localhost/api/admin/agents/agent-1/outbox?limit=10"),
      { params: Promise.resolve({ agentId: "agent-1" }) }
    );

    expect(response.status).toBe(200);
    expect(mocks.getAgentOutboxMetrics).toHaveBeenCalledWith("agent-1", 10, TENANT_ID);
  });
});
