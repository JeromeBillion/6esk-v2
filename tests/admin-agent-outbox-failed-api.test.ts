import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  getAgentIntegrationById: vi.fn(),
  listFailedAgentEvents: vi.fn()
}));

vi.mock("@/server/auth/session", () => ({
  getSessionUser: mocks.getSessionUser
}));

vi.mock("@/server/agents/integrations", () => ({
  getAgentIntegrationById: mocks.getAgentIntegrationById
}));

vi.mock("@/server/agents/outbox", () => ({
  listFailedAgentEvents: mocks.listFailedAgentEvents
}));

import { GET } from "@/app/api/admin/agents/[agentId]/outbox/failed/route";

function buildUser(roleName: "lead_admin" | "agent") {
  return {
    id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    email: `${roleName}@6ex.co.za`,
    display_name: roleName,
    role_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    role_name: roleName
  };
}

describe("GET /api/admin/agents/[agentId]/outbox/failed", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAgentIntegrationById.mockResolvedValue({ id: "agent-1", status: "active" });
    mocks.listFailedAgentEvents.mockResolvedValue([
      {
        id: "evt-1",
        event_type: "customer.identity.resolved",
        status: "failed",
        attempt_count: 5,
        last_error: "gateway timeout"
      }
    ]);
  });

  it("returns 403 for non-admin users", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser("agent"));

    const response = await GET(new Request("http://localhost/api/admin/agents/agent-1/outbox/failed"), {
      params: Promise.resolve({ agentId: "agent-1" })
    });
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toMatchObject({ error: "Forbidden" });
  });

  it("returns failed agent events for admins", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser("lead_admin"));

    const response = await GET(
      new Request("http://localhost/api/admin/agents/agent-1/outbox/failed?limit=25"),
      { params: Promise.resolve({ agentId: "agent-1" }) }
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.events).toHaveLength(1);
    expect(body.events[0]).toMatchObject({
      id: "evt-1",
      event_type: "customer.identity.resolved",
      last_error: "gateway timeout"
    });
    expect(mocks.listFailedAgentEvents).toHaveBeenCalledWith("agent-1", 25);
  });
});
