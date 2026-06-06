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
  normalizeWorkspaceModules
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

    const config = await getWorkspaceModules("workspace-a", "tenant-a");

    expect(config.source).toBe("fail_closed");
    expect(config.failureReason).toBe("missing_configuration");
    expect(config.modules).toEqual({
      email: false,
      whatsapp: false,
      voice: false,
      aiAutomation: false,
      vanillaWebchat: false
    });
  });

  it("fails closed when the entitlement store cannot be read", async () => {
    mocks.dbQuery.mockRejectedValue(new Error("database unavailable"));

    await expect(isWorkspaceModuleEnabled("email", "workspace-a", "tenant-a")).resolves.toBe(false);
  });

  it("normalizes structured entitlement states without breaking boolean modules", () => {
    expect(
      normalizeWorkspaceModules({
        email: { enabled: true, status: "active" },
        whatsapp: { enabled: true, status: "suspended" },
        voice: false,
        aiAutomation: { enabled: true, status: "downgrade_pending" },
        vanillaWebchat: true
      })
    ).toEqual({
      email: true,
      whatsapp: false,
      voice: false,
      aiAutomation: true,
      vanillaWebchat: true
    });
  });
});
