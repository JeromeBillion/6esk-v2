import { beforeEach, describe, expect, it, vi } from "vitest";

const TENANT_ID = "99999999-9999-4999-8999-999999999999";

const mocks = vi.hoisted(() => ({
  getActiveAgentIntegration: vi.fn(),
  getAgentIntegrationById: vi.fn()
}));

vi.mock("@/server/agents/integrations", () => ({
  getActiveAgentIntegration: mocks.getActiveAgentIntegration,
  getAgentIntegrationById: mocks.getAgentIntegrationById
}));

import { getAgentFromRequest } from "@/server/agents/auth";

function request(headers: Record<string, string>) {
  return new Request("http://localhost/api/agent/v1/actions", { headers });
}

function integration() {
  return {
    id: "agent-1",
    tenant_id: TENANT_ID,
    shared_secret: "secret"
  };
}

describe("agent machine auth tenant scope", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getActiveAgentIntegration.mockResolvedValue(integration());
    mocks.getAgentIntegrationById.mockResolvedValue(integration());
  });

  it("rejects agent keys without tenant scope before lookup", async () => {
    const result = await getAgentFromRequest(
      request({
        "x-6esk-agent-key": "secret",
        "x-6esk-agent-id": "agent-1"
      })
    );

    expect(result).toBeNull();
    expect(mocks.getAgentIntegrationById).not.toHaveBeenCalled();
    expect(mocks.getActiveAgentIntegration).not.toHaveBeenCalled();
  });

  it("looks up the named agent only inside the requested tenant", async () => {
    const result = await getAgentFromRequest(
      request({
        "x-6esk-agent-key": "secret",
        "x-6esk-agent-id": "agent-1",
        "x-6esk-tenant-id": TENANT_ID
      })
    );

    expect(result).toMatchObject({ id: "agent-1", tenant_id: TENANT_ID });
    expect(mocks.getAgentIntegrationById).toHaveBeenCalledWith("agent-1", TENANT_ID);
    expect(mocks.getActiveAgentIntegration).not.toHaveBeenCalled();
  });

  it("looks up the active agent only inside the requested tenant", async () => {
    const result = await getAgentFromRequest(
      request({
        "x-6esk-agent-key": "secret",
        "x-6esk-tenant-id": TENANT_ID
      })
    );

    expect(result).toMatchObject({ id: "agent-1", tenant_id: TENANT_ID });
    expect(mocks.getActiveAgentIntegration).toHaveBeenCalledWith(TENANT_ID);
  });

  it("rejects mismatched agent secrets after tenant-scoped lookup", async () => {
    const result = await getAgentFromRequest(
      request({
        authorization: "Bearer wrong",
        "x-6esk-tenant-id": TENANT_ID
      })
    );

    expect(result).toBeNull();
    expect(mocks.getActiveAgentIntegration).toHaveBeenCalledWith(TENANT_ID);
  });
});
