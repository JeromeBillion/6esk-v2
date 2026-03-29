import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAgentFromRequest: vi.fn(),
  isWorkspaceModuleEnabled: vi.fn()
}));

vi.mock("@/server/agents/auth", () => ({
  getAgentFromRequest: mocks.getAgentFromRequest
}));

vi.mock("@/server/workspace-modules", () => ({
  isWorkspaceModuleEnabled: mocks.isWorkspaceModuleEnabled
}));

import { POST } from "@/app/api/agent/v1/actions/route";

describe("POST /api/agent/v1/actions module guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAgentFromRequest.mockResolvedValue({
      id: "agent-1",
      status: "active",
      policy_mode: "auto_send",
      capabilities: {}
    });
    mocks.isWorkspaceModuleEnabled.mockResolvedValue(false);
  });

  it("blocks agent actions when AI automation is disabled", async () => {
    const response = await POST(
      new Request("http://localhost/api/agent/v1/actions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          actions: [
            {
              type: "draft_reply",
              ticketId: "11111111-1111-1111-1111-111111111111",
              text: "Hello"
            }
          ]
        })
      })
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toMatchObject({
      code: "module_disabled",
      module: "aiAutomation"
    });
  });
});
