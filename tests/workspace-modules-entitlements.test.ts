import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dbQuery: vi.fn()
}));

vi.mock("@/server/db", () => ({
  db: {
    query: mocks.dbQuery
  }
}));

import {
  getWorkspaceModules,
  isWorkspaceModuleEnabled,
  normalizeWorkspaceModules,
  saveWorkspaceModules
} from "@/server/workspace-modules";

const originalEntitlementsFailClosed = process.env.ENTITLEMENTS_FAIL_CLOSED;

describe("workspace module entitlements", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ENTITLEMENTS_FAIL_CLOSED = "true";
  });

  afterEach(() => {
    if (originalEntitlementsFailClosed === undefined) {
      delete process.env.ENTITLEMENTS_FAIL_CLOSED;
    } else {
      process.env.ENTITLEMENTS_FAIL_CLOSED = originalEntitlementsFailClosed;
    }
  });

  it("fails closed when entitlement configuration is missing", async () => {
    mocks.dbQuery.mockResolvedValue({ rows: [] });

    const config = await getWorkspaceModules("workspace-a", "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");

    expect(config.source).toBe("fail_closed");
    expect(config.failureReason).toBe("missing_configuration");
    expect(config.modules).toEqual({
      email: false,
      whatsapp: false,
      voice: false,
      aiAutomation: false,
      dexterOrchestration: false,
      vanillaWebchat: false
    });
  });

  it("fails closed without tenant scope before loading entitlement configuration", async () => {
    const config = await getWorkspaceModules("workspace-a", "");

    expect(config.source).toBe("fail_closed");
    expect(config.failureReason).toBe("missing_configuration");
    expect(config.modules).toEqual({
      email: false,
      whatsapp: false,
      voice: false,
      aiAutomation: false,
      dexterOrchestration: false,
      vanillaWebchat: false
    });
    expect(mocks.dbQuery).not.toHaveBeenCalled();
  });

  it("rejects entitlement writes without tenant scope", async () => {
    await expect(saveWorkspaceModules({ email: true }, "workspace-a", "")).rejects.toThrow(
      "Save workspace modules requires tenantId"
    );

    expect(mocks.dbQuery).not.toHaveBeenCalled();
  });

  it("returns disabled module access without tenant scope", async () => {
    await expect(isWorkspaceModuleEnabled("email", "workspace-a", "")).resolves.toBe(false);

    expect(mocks.dbQuery).not.toHaveBeenCalled();
  });

  it("fails closed when the entitlement store cannot be read", async () => {
    mocks.dbQuery
      .mockResolvedValueOnce({ rows: [{ status: "active" }] })
      .mockRejectedValueOnce(new Error("database unavailable"));

    await expect(
      isWorkspaceModuleEnabled("email", "workspace-a", "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")
    ).resolves.toBe(false);
  });

  it("normalizes structured entitlement states without breaking boolean modules", () => {
    expect(
      normalizeWorkspaceModules({
        email: { enabled: true, status: "active" } as never,
        whatsapp: { enabled: true, status: "suspended" } as never,
        voice: false,
        aiAutomation: { enabled: true, status: "downgrade_pending" } as never,
        dexterOrchestration: { enabled: false, status: "active" } as never,
        vanillaWebchat: true
      })
    ).toEqual({
      email: true,
      whatsapp: false,
      voice: false,
      aiAutomation: true,
      dexterOrchestration: false,
      vanillaWebchat: true
    });
  });
});
