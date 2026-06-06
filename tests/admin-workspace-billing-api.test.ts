import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireBillingAdminAccess: vi.fn(),
  getWorkspaceBillingOverview: vi.fn(),
  getCustomerSafeInvoiceExport: vi.fn(),
  ensureWorkspaceBillingSubscription: vi.fn(),
  recordBillingPlanChange: vi.fn(),
  recordManualBillingAdjustment: vi.fn(),
  createWorkspaceBillingInvoice: vi.fn(),
  transitionWorkspaceBillingInvoice: vi.fn(),
  updateBillingCollectionsState: vi.fn(),
  updateBillingSubscriptionLifecycle: vi.fn(),
  recordAuditLog: vi.fn()
}));

vi.mock("@/server/auth/admin-guard", () => ({
  requireBillingAdminAccess: mocks.requireBillingAdminAccess
}));

vi.mock("@/server/billing/lifecycle", () => ({
  getWorkspaceBillingOverview: mocks.getWorkspaceBillingOverview,
  getCustomerSafeInvoiceExport: mocks.getCustomerSafeInvoiceExport,
  ensureWorkspaceBillingSubscription: mocks.ensureWorkspaceBillingSubscription,
  recordBillingPlanChange: mocks.recordBillingPlanChange,
  recordManualBillingAdjustment: mocks.recordManualBillingAdjustment,
  createWorkspaceBillingInvoice: mocks.createWorkspaceBillingInvoice,
  transitionWorkspaceBillingInvoice: mocks.transitionWorkspaceBillingInvoice,
  updateBillingCollectionsState: mocks.updateBillingCollectionsState,
  updateBillingSubscriptionLifecycle: mocks.updateBillingSubscriptionLifecycle
}));

vi.mock("@/server/audit", () => ({
  recordAuditLog: mocks.recordAuditLog
}));

import { GET, POST } from "@/app/api/admin/workspace/billing/route";

const ACCESS = {
  ok: true,
  user: { id: "33333333-3333-3333-3333-333333333333", role_name: "finance_admin" },
  scope: { tenantKey: "tenant-a", workspaceKey: "workspace-a" }
};

describe("workspace billing admin API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireBillingAdminAccess.mockResolvedValue(ACCESS);
    mocks.getWorkspaceBillingOverview.mockResolvedValue({ subscription: null, invoices: [] });
    mocks.getCustomerSafeInvoiceExport.mockResolvedValue({
      formatVersion: "workspace-invoice-export.v1",
      invoice: { status: "issued", lines: [] }
    });
    mocks.ensureWorkspaceBillingSubscription.mockResolvedValue({ id: "sub-1" });
    mocks.recordBillingPlanChange.mockResolvedValue({ change: { id: "change-1" } });
    mocks.recordManualBillingAdjustment.mockResolvedValue({ adjustment: { id: "adjustment-1" } });
    mocks.createWorkspaceBillingInvoice.mockResolvedValue({ id: "invoice-1" });
    mocks.transitionWorkspaceBillingInvoice.mockResolvedValue({ id: "invoice-1", status: "paid" });
    mocks.updateBillingCollectionsState.mockResolvedValue({ event: { id: "event-1" } });
    mocks.updateBillingSubscriptionLifecycle.mockResolvedValue({ id: "sub-1" });
    mocks.recordAuditLog.mockResolvedValue(undefined);
  });

  it("requires billing admin MFA access", async () => {
    const forbidden = Response.json({ error: "MFA required" }, { status: 403 });
    mocks.requireBillingAdminAccess.mockResolvedValue({ ok: false, response: forbidden });

    const response = await GET(new Request("http://localhost/api/admin/workspace/billing"));

    expect(response.status).toBe(403);
    expect(mocks.requireBillingAdminAccess).toHaveBeenCalledWith({ requireMfa: true });
    expect(mocks.getWorkspaceBillingOverview).not.toHaveBeenCalled();
  });

  it("returns a tenant-scoped billing overview", async () => {
    const response = await GET(new Request("http://localhost/api/admin/workspace/billing"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ overview: { subscription: null } });
    expect(mocks.getWorkspaceBillingOverview).toHaveBeenCalledWith({
      tenantKey: "tenant-a",
      workspaceKey: "workspace-a"
    });
  });

  it("exports a customer-safe invoice and audits metadata only", async () => {
    const invoiceId = "22222222-2222-2222-2222-222222222222";
    const response = await GET(
      new Request(`http://localhost/api/admin/workspace/billing?invoiceId=${invoiceId}`)
    );

    expect(response.status).toBe(200);
    expect(mocks.getCustomerSafeInvoiceExport).toHaveBeenCalledWith({
      tenantKey: "tenant-a",
      workspaceKey: "workspace-a",
      invoiceId
    });
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantKey: "tenant-a",
        workspaceKey: "workspace-a",
        action: "billing_invoice_exported",
        entityId: invoiceId,
        data: expect.objectContaining({
          formatVersion: "workspace-invoice-export.v1",
          lineCount: 0
        })
      })
    );
  });

  it("records a scoped plan change through the billing service", async () => {
    const response = await POST(
      new Request("http://localhost/api/admin/workspace/billing", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "plan_change",
          toModules: {
            email: true,
            whatsapp: true,
            voice: false,
            aiAutomation: false,
            vanillaWebchat: true
          },
          effectiveAt: "2026-06-16T00:00:00.000Z"
        })
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.recordBillingPlanChange).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantKey: "tenant-a",
        workspaceKey: "workspace-a",
        actor: { userId: ACCESS.user.id },
        toModules: expect.objectContaining({ whatsapp: true })
      })
    );
  });

  it("rejects malformed billing actions before service calls", async () => {
    const response = await POST(
      new Request("http://localhost/api/admin/workspace/billing", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "manual_adjustment", amountCents: -1 })
      })
    );

    expect(response.status).toBe(400);
    expect(mocks.recordManualBillingAdjustment).not.toHaveBeenCalled();
  });
});
