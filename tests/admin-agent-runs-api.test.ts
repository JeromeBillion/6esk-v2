import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  getAgentIntegrationById: vi.fn(),
  listRecentAgentRuns: vi.fn()
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

vi.mock("@/server/agents/run-ledger", () => ({
  listRecentAgentRuns: mocks.listRecentAgentRuns
}));

import { GET } from "@/app/api/admin/agents/[agentId]/runs/route";

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

describe("GET /api/admin/agents/[agentId]/runs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAgentIntegrationById.mockResolvedValue({ id: "agent-1", status: "active" });
    mocks.listRecentAgentRuns.mockResolvedValue([
      {
        id: "run-1",
        status: "queued",
        lane_key: "primary:ticket:ticket-1"
      }
    ]);
  });

  it("returns 403 for non-admin users", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser("agent"));

    const response = await GET(new Request("http://localhost/api/admin/agents/agent-1/runs"), {
      params: Promise.resolve({ agentId: "agent-1" })
    });
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toMatchObject({ error: "Forbidden" });
  });

  it("returns recent agent runs for admins", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser("lead_admin"));

    const response = await GET(
      new Request("http://localhost/api/admin/agents/agent-1/runs?limit=25"),
      { params: Promise.resolve({ agentId: "agent-1" }) }
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.runs).toHaveLength(1);
    expect(mocks.getAgentIntegrationById).toHaveBeenCalledWith("agent-1", {
      tenantKey: "tenant-a",
      workspaceKey: "workspace-a"
    });
    expect(mocks.listRecentAgentRuns).toHaveBeenCalledWith({
      integrationId: "agent-1",
      tenantKey: "tenant-a",
      workspaceKey: "workspace-a",
      limit: 25
    });
  });
});
