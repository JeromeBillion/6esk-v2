import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireLeadAdminAccess: vi.fn(),
  getWorkspaceModules: vi.fn(),
  getWorkspaceModuleUsageSummary: vi.fn(),
  recordAuditLog: vi.fn()
}));

vi.mock("@/server/auth/admin-guard", () => ({
  requireLeadAdminAccess: mocks.requireLeadAdminAccess
}));

vi.mock("@/server/workspace-modules", () => ({
  getWorkspaceModules: mocks.getWorkspaceModules
}));

vi.mock("@/server/module-metering", () => ({
  getWorkspaceModuleUsageSummary: mocks.getWorkspaceModuleUsageSummary
}));

vi.mock("@/server/audit", () => ({
  recordAuditLog: mocks.recordAuditLog
}));

import { GET } from "@/app/api/admin/workspace/usage/export/route";

const ACCESS = {
  ok: true,
  user: { id: "user-1" },
  scope: { tenantKey: "tenant-a", workspaceKey: "workspace-a" }
};

const MODULES = {
  workspaceKey: "workspace-a",
  updatedAt: "2026-06-05T10:00:00.000Z",
  modules: {
    email: true,
    whatsapp: true,
    voice: false,
    aiAutomation: true,
    vanillaWebchat: true
  }
};

const USAGE = {
  workspaceKey: "workspace-a",
  windowDays: 30,
  generatedAt: "2026-06-05T10:00:00.000Z",
  daily: [
    {
      date: "2026-06-05",
      totalQuantity: 7,
      eventCount: 7,
      modules: { email: 3, whatsapp: 2, voice: 0, aiAutomation: 2, vanillaWebchat: 0 }
    }
  ],
  modules: [
    {
      moduleKey: "email",
      totalQuantity: 3,
      eventCount: 3,
      actorBreakdown: { human: 2, ai: 1, system: 0 },
      lastSeenAt: "2026-06-05T10:00:00.000Z",
      usageKinds: [{ usageKind: "reply_sent", quantity: 3, eventCount: 3 }]
    }
  ]
};

describe("workspace usage export API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireLeadAdminAccess.mockResolvedValue(ACCESS);
    mocks.getWorkspaceModules.mockResolvedValue(MODULES);
    mocks.getWorkspaceModuleUsageSummary.mockImplementation(
      async (input: { windowDays?: number } = {}) => ({
        ...USAGE,
        windowDays: input.windowDays ?? USAGE.windowDays
      })
    );
    mocks.recordAuditLog.mockResolvedValue(undefined);
  });

  it("requires lead-admin MFA access", async () => {
    const forbidden = Response.json({ error: "MFA required" }, { status: 403 });
    mocks.requireLeadAdminAccess.mockResolvedValue({ ok: false, response: forbidden });

    const response = await GET(new Request("http://localhost/api/admin/workspace/usage/export"));

    expect(response.status).toBe(403);
    expect(mocks.requireLeadAdminAccess).toHaveBeenCalledWith({ requireMfa: true });
    expect(mocks.getWorkspaceModuleUsageSummary).not.toHaveBeenCalled();
  });

  it("exports tenant-scoped JSON usage with quote data and audit metadata", async () => {
    const response = await GET(
      new Request("http://localhost/api/admin/workspace/usage/export?days=45")
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      formatVersion: "workspace-usage-export.v1",
      workspaceKey: "workspace-a",
      windowDays: 45,
      quote: {
        currency: "ZAR",
        billingPeriod: "month"
      }
    });
    expect(mocks.getWorkspaceModules).toHaveBeenCalledWith("workspace-a", "tenant-a");
    expect(mocks.getWorkspaceModuleUsageSummary).toHaveBeenCalledWith({
      tenantKey: "tenant-a",
      workspaceKey: "workspace-a",
      windowDays: 45
    });
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantKey: "tenant-a",
        workspaceKey: "workspace-a",
        action: "workspace_usage_exported",
        data: expect.objectContaining({ format: "json", windowDays: 45 })
      })
    );
    expect(JSON.stringify(body)).not.toMatch(/customer|phone|email@example/i);
  });

  it("exports customer-safe CSV rows", async () => {
    const response = await GET(
      new Request("http://localhost/api/admin/workspace/usage/export?format=csv")
    );
    const text = await response.text();

    expect(response.headers.get("content-type")).toContain("text/csv");
    expect(text).toContain("module,usage_kind,quantity,event_count,human,ai,system");
    expect(text).toContain("email,reply_sent,3,3,2,1,0");
    expect(text).not.toMatch(/tenant-a|customer|phone/i);
  });
});
