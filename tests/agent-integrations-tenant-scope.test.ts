import { beforeEach, describe, expect, it, vi } from "vitest";

const TENANT_ID = "99999999-9999-4999-8999-999999999999";

const mocks = vi.hoisted(() => ({
  dbQuery: vi.fn(),
  getPlatformMailbox: vi.fn(),
  encryptSecret: vi.fn((value: string) => `enc:${value}`),
  decryptSecret: vi.fn((value: string) => value.replace(/^enc:/, ""))
}));

vi.mock("@/server/db", () => ({
  db: {
    query: mocks.dbQuery
  }
}));

vi.mock("@/server/mailboxes", () => ({
  getPlatformMailbox: mocks.getPlatformMailbox
}));

vi.mock("@/server/agents/secret", () => ({
  encryptSecret: mocks.encryptSecret,
  decryptSecret: mocks.decryptSecret
}));

import {
  createAgentIntegration,
  getActiveAgentIntegration,
  getAgentIntegrationById,
  listAgentIntegrations,
  updateAgentIntegration
} from "@/server/agents/integrations";

function integrationRow() {
  return {
    id: "agent-1",
    tenant_id: TENANT_ID,
    name: "Dexter",
    provider: "elizaos",
    base_url: "https://dexter.example.com",
    auth_type: "hmac",
    shared_secret: "enc:secret",
    status: "active",
    policy_mode: "draft_only",
    scopes: {},
    capabilities: {},
    policy: {},
    created_at: "2026-06-06T00:00:00.000Z",
    updated_at: "2026-06-06T00:00:00.000Z"
  };
}

describe("agent integration service tenant scope", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.dbQuery.mockResolvedValue({ rows: [] });
    mocks.getPlatformMailbox.mockResolvedValue({ id: "mailbox-1" });
  });

  it("does not list or activate agent integrations without tenant scope", async () => {
    await expect(listAgentIntegrations("")).resolves.toEqual([]);
    await expect(getActiveAgentIntegration("")).resolves.toBeNull();
    await expect(getAgentIntegrationById("agent-1", "")).resolves.toBeNull();
    await expect(updateAgentIntegration("agent-1", { status: "paused" }, "")).resolves.toBeNull();

    expect(mocks.dbQuery).not.toHaveBeenCalled();
  });

  it("rejects agent integration creation without tenant scope", async () => {
    await expect(
      createAgentIntegration({
        tenantId: "",
        name: "Dexter",
        baseUrl: "https://dexter.example.com",
        sharedSecret: "secret"
      })
    ).rejects.toThrow("Create agent integration requires tenantId");

    expect(mocks.getPlatformMailbox).not.toHaveBeenCalled();
    expect(mocks.dbQuery).not.toHaveBeenCalled();
  });

  it("creates agent integrations under the explicit tenant scope", async () => {
    mocks.dbQuery.mockResolvedValueOnce({ rows: [integrationRow()] });

    const result = await createAgentIntegration({
      tenantId: TENANT_ID,
      name: "Dexter",
      baseUrl: "https://dexter.example.com",
      sharedSecret: "secret"
    });

    expect(mocks.getPlatformMailbox).toHaveBeenCalledWith(TENANT_ID);
    expect(mocks.dbQuery.mock.calls[0]?.[1]?.[0]).toBe(TENANT_ID);
    expect(result).toMatchObject({
      id: "agent-1",
      tenant_id: TENANT_ID,
      shared_secret: "secret"
    });
  });
});
