import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dbQuery: vi.fn()
}));

vi.mock("@/server/db", () => ({
  db: {
    query: mocks.dbQuery
  }
}));

import { recordModuleUsageEvent } from "@/server/module-metering";

const originalEntitlementsFailClosed = process.env.ENTITLEMENTS_FAIL_CLOSED;
const originalModuleMeteringFailClosed = process.env.MODULE_METERING_FAIL_CLOSED;

describe("module metering fail-closed posture", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ENTITLEMENTS_FAIL_CLOSED = "true";
    process.env.MODULE_METERING_FAIL_CLOSED = "true";
  });

  afterEach(() => {
    if (originalEntitlementsFailClosed === undefined) {
      delete process.env.ENTITLEMENTS_FAIL_CLOSED;
    } else {
      process.env.ENTITLEMENTS_FAIL_CLOSED = originalEntitlementsFailClosed;
    }

    if (originalModuleMeteringFailClosed === undefined) {
      delete process.env.MODULE_METERING_FAIL_CLOSED;
    } else {
      process.env.MODULE_METERING_FAIL_CLOSED = originalModuleMeteringFailClosed;
    }
  });

  it("blocks usage recording when module entitlements fail closed", async () => {
    mocks.dbQuery.mockRejectedValue(new Error("metering unavailable"));

    await expect(
      recordModuleUsageEvent({
        tenantKey: "tenant-a",
        workspaceKey: "workspace-a",
        moduleKey: "email",
        usageKind: "reply_sent",
        actorType: "human",
        providerMode: "managed",
          metadata: { route: "/api/tickets/[ticketId]/replies" }
      })
    ).rejects.toThrow("Module email is not enabled");
  });

  it("surfaces usage write failures when entitlements allow recording", async () => {
    mocks.dbQuery
      .mockResolvedValueOnce({
        rows: [
          {
            tenant_key: "tenant-a",
            workspace_key: "workspace-a",
            modules: {
              email: { enabled: true, status: "active" },
              whatsapp: false,
              voice: false,
              aiAutomation: false,
              vanillaWebchat: true
            },
            updated_at: "2026-06-06T00:00:00.000Z"
          }
        ]
      })
      .mockRejectedValueOnce(new Error("metering unavailable"));

    await expect(
      recordModuleUsageEvent({
        tenantKey: "tenant-a",
        workspaceKey: "workspace-a",
        moduleKey: "email",
        usageKind: "reply_sent",
        actorType: "human",
        providerMode: "managed",
        metadata: { route: "/api/tickets/[ticketId]/replies" }
      })
    ).rejects.toThrow("metering unavailable");
  });
});
