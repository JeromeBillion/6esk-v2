import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  isTenantAdmin: vi.fn(),
  getWorkspaceModules: vi.fn(),
  getWorkspaceModuleUsageSummary: vi.fn(),
  getTenantBillingLifecycleSnapshot: vi.fn(),
  recordAuditLog: vi.fn()
}));

vi.mock("@/server/auth/session", () => ({
  getSessionUser: mocks.getSessionUser
}));

vi.mock("@/server/auth/roles", () => ({
  isTenantAdmin: mocks.isTenantAdmin
}));

vi.mock("@/server/workspace-modules", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/workspace-modules")>();
  return {
    ...actual,
    getWorkspaceModules: mocks.getWorkspaceModules
  };
});

vi.mock("@/server/module-metering", () => ({
  getWorkspaceModuleUsageSummary: mocks.getWorkspaceModuleUsageSummary
}));

vi.mock("@/server/billing/lifecycle", () => ({
  getTenantBillingLifecycleSnapshot: mocks.getTenantBillingLifecycleSnapshot
}));

vi.mock("@/server/audit", () => ({
  recordAuditLog: mocks.recordAuditLog
}));

import { GET } from "@/app/api/admin/workspace/usage/export/route";

const TENANT_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const USER_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

describe("workspace usage export API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSessionUser.mockResolvedValue({
      id: USER_ID,
      tenant_id: TENANT_ID,
      role_name: "tenant_admin"
    });
    mocks.isTenantAdmin.mockReturnValue(true);
    mocks.getWorkspaceModules.mockResolvedValue({
      workspaceKey: "primary",
      tenantId: TENANT_ID,
      updatedAt: "2026-06-06T10:00:00.000Z",
      modules: {
        email: true,
        whatsapp: true,
        voice: false,
        aiAutomation: true,
        dexterOrchestration: true,
        vanillaWebchat: true
      }
    });
    mocks.getWorkspaceModuleUsageSummary.mockResolvedValue({
      workspaceKey: "primary",
      windowDays: 45,
      generatedAt: "2026-06-06T10:00:00.000Z",
      daily: [
        {
          date: "2026-06-06",
          totalQuantity: 7,
          eventCount: 7,
          modules: {
            email: 3,
            whatsapp: 2,
            voice: 0,
            aiAutomation: 2,
            dexterOrchestration: 0,
            vanillaWebchat: 0
          }
        }
      ],
      modules: [
        {
          moduleKey: "email",
          totalQuantity: 3,
          eventCount: 3,
          actorBreakdown: { human: 2, ai: 1, system: 0 },
          lastSeenAt: "2026-06-06T10:00:00.000Z",
          usageKinds: [{ usageKind: "outbound_email", quantity: 3, eventCount: 3 }]
        }
      ]
    });
    mocks.getTenantBillingLifecycleSnapshot.mockResolvedValue({
      account: { currency: "ZAR" },
      estimatedInvoice: {
        periodStart: "2026-06-01T00:00:00.000Z",
        periodEnd: "2026-07-01T00:00:00.000Z",
        subtotalCent: 219700,
        usageCent: 15,
        adjustmentCent: 0,
        taxCent: 0,
        totalCent: 219715,
        amountDueCent: 219715,
        lines: [
          {
            lineType: "usage",
            moduleKey: "email",
            usageKind: "outbound_email",
            description: "Email usage: outbound_email",
            quantity: 3,
            unitAmountCent: 5,
            amountCent: 15,
            currency: "ZAR",
            metadata: { eventId: "redacted" }
          }
        ]
      }
    });
    mocks.recordAuditLog.mockResolvedValue(undefined);
  });

  it("exports tenant-scoped usage JSON with invoice estimate and audit metadata", async () => {
    const response = await GET(
      new Request("http://localhost/api/admin/workspace/usage/export?days=45")
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      formatVersion: "workspace-usage-export.v1",
      workspaceKey: "primary",
      windowDays: 45,
      estimatedInvoice: {
        currency: "ZAR",
        usageCent: 15,
        totalCent: 219715
      },
      usage: {
        daily: [{ date: "2026-06-06", totalQuantity: 7 }]
      }
    });
    expect(JSON.stringify(body)).not.toContain(TENANT_ID);
    expect(mocks.getWorkspaceModuleUsageSummary).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      workspaceKey: "primary",
      windowDays: 45
    });
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT_ID,
        actorUserId: USER_ID,
        action: "workspace_usage_exported",
        data: expect.objectContaining({ format: "json", windowDays: 45, dailyBucketCount: 1 })
      })
    );
  });

  it("exports customer-safe CSV usage rows", async () => {
    const response = await GET(
      new Request("http://localhost/api/admin/workspace/usage/export?format=csv")
    );
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/csv");
    expect(text).toContain("module,usage_kind,quantity,event_count,human,ai,system");
    expect(text).toContain("email,outbound_email,3,3,2,1,0");
    expect(text).not.toMatch(/customer|phone|aaaaaaaa-aaaa/i);
  });

  it("blocks non-admin usage exports", async () => {
    mocks.isTenantAdmin.mockReturnValue(false);

    const response = await GET(new Request("http://localhost/api/admin/workspace/usage/export"));

    expect(response.status).toBe(403);
    expect(mocks.getWorkspaceModuleUsageSummary).not.toHaveBeenCalled();
  });
});
