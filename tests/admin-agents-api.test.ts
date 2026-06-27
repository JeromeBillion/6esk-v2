import { beforeEach, describe, expect, it, vi } from "vitest";

const TENANT_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  listAgentIntegrations: vi.fn(),
  getAgentIntegrationById: vi.fn(),
  getAgentOutboxMetrics: vi.fn(),
  createAgentIntegration: vi.fn(),
  updateAgentIntegration: vi.fn(),
  recordAuditLog: vi.fn()
}));

vi.mock("@/server/auth/session", () => ({
  getSessionUser: mocks.getSessionUser
}));

vi.mock("@/server/agents/integrations", () => ({
  listAgentIntegrations: mocks.listAgentIntegrations,
  getAgentIntegrationById: mocks.getAgentIntegrationById,
  createAgentIntegration: mocks.createAgentIntegration,
  updateAgentIntegration: mocks.updateAgentIntegration
}));

vi.mock("@/server/agents/outbox-metrics", () => ({
  getAgentOutboxMetrics: mocks.getAgentOutboxMetrics
}));

vi.mock("@/server/audit", () => ({
  recordAuditLog: mocks.recordAuditLog
}));

import { GET as listAgents, POST as createAgent } from "@/app/api/admin/agents/route";
import { GET as getAgent, PATCH as updateAgent } from "@/app/api/admin/agents/[agentId]/route";
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
    mocks.createAgentIntegration.mockResolvedValue({
      id: "agent-1",
      name: "Dexter",
      base_url: "https://dexter.example.com",
      status: "active"
    });
    mocks.updateAgentIntegration.mockResolvedValue({
      id: "agent-1",
      name: "Dexter",
      base_url: "https://dexter.example.com",
      status: "active"
    });
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

  it("rejects local agent webhook URLs during creation", async () => {
    const response = await createAgent(
      new Request("http://localhost/api/admin/agents", {
        method: "POST",
        body: JSON.stringify({
          name: "Dexter",
          baseUrl: "http://localhost:3001",
          sharedSecret: "super-secret"
        })
      })
    );

    expect(response.status).toBe(400);
    expect(mocks.createAgentIntegration).not.toHaveBeenCalled();
  });

  it("passes public agent webhook URLs into creation", async () => {
    const response = await createAgent(
      new Request("http://localhost/api/admin/agents", {
        method: "POST",
        body: JSON.stringify({
          name: "Dexter",
          baseUrl: "https://dexter.example.com",
          sharedSecret: "super-secret"
        })
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.createAgentIntegration).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT_ID,
        baseUrl: "https://dexter.example.com"
      })
    );
  });

  it("rejects private agent webhook URLs during update", async () => {
    const response = await updateAgent(
      new Request("http://localhost/api/admin/agents/agent-1", {
        method: "PATCH",
        body: JSON.stringify({ baseUrl: "https://10.0.0.5" })
      }),
      { params: Promise.resolve({ agentId: "agent-1" }) }
    );

    expect(response.status).toBe(400);
    expect(mocks.updateAgentIntegration).not.toHaveBeenCalled();
  });
});
