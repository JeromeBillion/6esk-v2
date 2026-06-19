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
  getWorkspaceModuleUsageSummary,
  recordModuleUsageEvent
} from "@/server/module-metering";

const originalEntitlementsFailClosed = process.env.ENTITLEMENTS_FAIL_CLOSED;
const originalModuleMeteringFailClosed = process.env.MODULE_METERING_FAIL_CLOSED;
const TENANT_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

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
        tenantId: TENANT_ID,
        workspaceKey: "primary",
        moduleKey: "email",
        usageKind: "reply_sent",
        actorType: "human",
        providerMode: "managed",
        metadata: { route: "/api/tickets/[ticketId]/replies" }
      })
    ).rejects.toThrow("Module email is not enabled");
  });

  it("rejects usage recording without tenant scope in fail-closed mode", async () => {
    await expect(
      recordModuleUsageEvent({
        tenantId: "",
        workspaceKey: "primary",
        moduleKey: "email",
        usageKind: "reply_sent",
        actorType: "human",
        providerMode: "managed",
        metadata: { route: "/api/tickets/[ticketId]/replies" }
      })
    ).rejects.toThrow("Module usage tenantId is required");

    expect(mocks.dbQuery).not.toHaveBeenCalled();
  });

  it("does not read default-tenant usage when summary tenant scope is missing", async () => {
    const summary = await getWorkspaceModuleUsageSummary({
      tenantId: "",
      workspaceKey: "primary",
      windowDays: 45
    });

    expect(summary).toMatchObject({
      workspaceKey: "primary",
      windowDays: 45,
      daily: []
    });
    expect(summary.modules).toHaveLength(6);
    expect(summary.modules.every((module) => module.totalQuantity === 0)).toBe(true);
    expect(mocks.dbQuery).not.toHaveBeenCalled();
  });

  it("surfaces usage write failures when entitlements allow recording", async () => {
    mocks.dbQuery
      .mockResolvedValueOnce({ rows: [{ status: "active" }] })
      .mockResolvedValueOnce({
        rows: [
          {
            tenant_id: TENANT_ID,
            workspace_key: "primary",
            modules: {
              email: { enabled: true, status: "active" },
              whatsapp: false,
              voice: false,
              aiAutomation: false,
              dexterOrchestration: false,
              vanillaWebchat: true
            },
            updated_at: "2026-06-06T00:00:00.000Z"
          }
        ]
      })
      .mockRejectedValueOnce(new Error("metering unavailable"));

    await expect(
      recordModuleUsageEvent({
        tenantId: TENANT_ID,
        workspaceKey: "primary",
        moduleKey: "email",
        usageKind: "reply_sent",
        actorType: "human",
        providerMode: "managed",
        metadata: { route: "/api/tickets/[ticketId]/replies" }
      })
    ).rejects.toThrow("metering unavailable");
  });
});
