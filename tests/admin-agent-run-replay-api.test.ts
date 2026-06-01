import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  getAgentIntegrationById: vi.fn(),
  getAgentPolicyReplay: vi.fn()
}));

vi.mock("@/server/auth/session", () => ({
  getSessionUser: mocks.getSessionUser
}));

vi.mock("@/server/auth/roles", () => ({
  isLeadAdmin: (user: { role_name?: string | null } | null) => user?.role_name === "lead_admin"
}));

vi.mock("@/server/agents/integrations", () => ({
  getAgentIntegrationById: mocks.getAgentIntegrationById
}));

vi.mock("@/server/agents/policy-replay", () => ({
  getAgentPolicyReplay: mocks.getAgentPolicyReplay
}));

import { GET } from "@/app/api/admin/agents/[agentId]/runs/[runId]/replay/route";

function buildUser(roleName: "lead_admin" | "agent") {
  return {
    id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    email: `${roleName}@6ex.co.za`,
    display_name: roleName,
    role_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    role_name: roleName,
    tenant_key: "tenant-a",
    workspace_key: "workspace-a"
  };
}

describe("GET /api/admin/agents/[agentId]/runs/[runId]/replay", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSessionUser.mockResolvedValue(buildUser("lead_admin"));
    mocks.getAgentIntegrationById.mockResolvedValue({ id: "agent-1", tenant_key: "tenant-a" });
    mocks.getAgentPolicyReplay.mockResolvedValue({
      status: "complete",
      explanation: "Replay evidence is complete.",
      missingEvidence: [],
      run: { id: "run-1" },
      promptSandbox: {},
      promptTemplate: {},
      evidence: {
        events: [],
        steps: [],
        toolCalls: [],
        guardEvents: [],
        policyDecisions: []
      }
    });
  });

  it("blocks non-admin users", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser("agent"));

    const response = await GET(
      new Request("http://localhost/api/admin/agents/agent-1/runs/run-1/replay"),
      { params: Promise.resolve({ agentId: "agent-1", runId: "run-1" }) }
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toMatchObject({ error: "Forbidden" });
  });

  it("returns 404 when the agent is outside the tenant scope", async () => {
    mocks.getAgentIntegrationById.mockResolvedValue(null);

    const response = await GET(
      new Request("http://localhost/api/admin/agents/agent-1/runs/run-1/replay"),
      { params: Promise.resolve({ agentId: "agent-1", runId: "run-1" }) }
    );
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toMatchObject({ error: "Not found" });
  });

  it("returns tenant-scoped replay evidence for lead admins", async () => {
    const response = await GET(
      new Request("http://localhost/api/admin/agents/agent-1/runs/run-1/replay"),
      { params: Promise.resolve({ agentId: "agent-1", runId: "run-1" }) }
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.replay.status).toBe("complete");
    expect(mocks.getAgentIntegrationById).toHaveBeenCalledWith("agent-1", {
      tenantKey: "tenant-a",
      workspaceKey: "workspace-a"
    });
    expect(mocks.getAgentPolicyReplay).toHaveBeenCalledWith({
      runId: "run-1",
      integrationId: "agent-1",
      scope: {
        tenantKey: "tenant-a",
        workspaceKey: "workspace-a"
      }
    });
  });
});
