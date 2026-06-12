import { beforeEach, describe, expect, it, vi } from "vitest";

const DEFAULT_TENANT_ID = "00000000-0000-0000-0000-000000000001";
const RUN_ID = "22222222-2222-4222-8222-222222222222";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  getAgentIntegrationById: vi.fn(),
  getAgentRunReplay: vi.fn()
}));

vi.mock("@/server/auth/session", () => ({
  getSessionUser: mocks.getSessionUser
}));

vi.mock("@/server/agents/integrations", () => ({
  getAgentIntegrationById: mocks.getAgentIntegrationById
}));

vi.mock("@/server/agents/run-replay", () => ({
  getAgentRunReplay: mocks.getAgentRunReplay
}));

import { GET } from "@/app/api/admin/agents/[agentId]/runs/[runId]/replay/route";

function buildUser(roleName: "lead_admin" | "agent") {
  return {
    id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    email: `${roleName}@6ex.co.za`,
    display_name: roleName,
    role_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    role_name: roleName
  };
}

describe("GET /api/admin/agents/[agentId]/runs/[runId]/replay", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSessionUser.mockResolvedValue(buildUser("lead_admin"));
    mocks.getAgentIntegrationById.mockResolvedValue({ id: "agent-1", status: "active" });
    mocks.getAgentRunReplay.mockResolvedValue({
      status: "complete",
      explanation: "Replay evidence is complete.",
      missingEvidence: [],
      run: { id: RUN_ID },
      evidence: {
        events: [],
        steps: [],
        toolCalls: [],
        policyDecisions: [],
        knowledgeRetrievals: []
      }
    });
  });

  it("returns 403 for non-admin users", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser("agent"));

    const response = await GET(
      new Request(`http://localhost/api/admin/agents/agent-1/runs/${RUN_ID}/replay`),
      { params: Promise.resolve({ agentId: "agent-1", runId: RUN_ID }) }
    );

    expect(response.status).toBe(403);
    expect(mocks.getAgentIntegrationById).not.toHaveBeenCalled();
    expect(mocks.getAgentRunReplay).not.toHaveBeenCalled();
  });

  it("returns tenant-scoped replay evidence for lead admins", async () => {
    const response = await GET(
      new Request(`http://localhost/api/admin/agents/agent-1/runs/${RUN_ID}/replay`),
      { params: Promise.resolve({ agentId: "agent-1", runId: RUN_ID }) }
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      replay: {
        status: "complete",
        run: { id: RUN_ID }
      }
    });
    expect(mocks.getAgentIntegrationById).toHaveBeenCalledWith("agent-1", DEFAULT_TENANT_ID);
    expect(mocks.getAgentRunReplay).toHaveBeenCalledWith({
      tenantId: DEFAULT_TENANT_ID,
      integrationId: "agent-1",
      runId: RUN_ID
    });
  });

  it("returns 404 when the agent is outside the admin tenant", async () => {
    mocks.getAgentIntegrationById.mockResolvedValue(null);

    const response = await GET(
      new Request(`http://localhost/api/admin/agents/foreign-agent/runs/${RUN_ID}/replay`),
      { params: Promise.resolve({ agentId: "foreign-agent", runId: RUN_ID }) }
    );

    expect(response.status).toBe(404);
    expect(mocks.getAgentRunReplay).not.toHaveBeenCalled();
  });

  it("returns 404 when replay evidence cannot be found", async () => {
    mocks.getAgentRunReplay.mockResolvedValue(null);

    const response = await GET(
      new Request(`http://localhost/api/admin/agents/agent-1/runs/${RUN_ID}/replay`),
      { params: Promise.resolve({ agentId: "agent-1", runId: RUN_ID }) }
    );

    expect(response.status).toBe(404);
  });
});
