import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  isInternalStaff: vi.fn(),
  getTenantById: vi.fn(),
  getTenantBillingLifecycleSnapshot: vi.fn(),
  syncTenantSubscriptionFromCatalog: vi.fn(),
  createBillingAdjustment: vi.fn(),
  createInvoiceDraft: vi.fn(),
  transitionInvoiceStatus: vi.fn(),
  recordCollectionEvent: vi.fn()
}));

vi.mock("@/server/auth/session", () => ({
  getSessionUser: mocks.getSessionUser
}));

vi.mock("@/server/auth/roles", () => ({
  isInternalStaff: mocks.isInternalStaff
}));

vi.mock("@/server/tenant/lifecycle", () => ({
  getTenantById: mocks.getTenantById
}));

vi.mock("@/server/billing/lifecycle", () => ({
  getTenantBillingLifecycleSnapshot: mocks.getTenantBillingLifecycleSnapshot,
  syncTenantSubscriptionFromCatalog: mocks.syncTenantSubscriptionFromCatalog,
  createBillingAdjustment: mocks.createBillingAdjustment,
  createInvoiceDraft: mocks.createInvoiceDraft,
  transitionInvoiceStatus: mocks.transitionInvoiceStatus,
  recordCollectionEvent: mocks.recordCollectionEvent
}));

import { GET, POST } from "@/app/api/backoffice/billing/[tenantId]/route";

const TENANT_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const USER_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

function params() {
  return { params: Promise.resolve({ tenantId: TENANT_ID }) };
}

function request(body: unknown) {
  return new Request(`http://localhost/api/backoffice/billing/${TENANT_ID}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}

describe("backoffice billing lifecycle API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSessionUser.mockResolvedValue({ id: USER_ID, role_name: "internal_admin" });
    mocks.isInternalStaff.mockReturnValue(true);
    mocks.getTenantById.mockResolvedValue({ id: TENANT_ID, slug: "acme", status: "active" });
    mocks.getTenantBillingLifecycleSnapshot.mockResolvedValue({ tenantId: TENANT_ID });
  });

  it("rejects non-internal users", async () => {
    mocks.isInternalStaff.mockReturnValue(false);

    const response = await GET(
      new Request(`http://localhost/api/backoffice/billing/${TENANT_ID}`),
      params()
    );

    expect(response.status).toBe(403);
  });

  it("returns tenant billing lifecycle for internal staff", async () => {
    const response = await GET(
      new Request(`http://localhost/api/backoffice/billing/${TENANT_ID}`),
      params()
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.billing).toEqual({ tenantId: TENANT_ID });
    expect(mocks.getTenantBillingLifecycleSnapshot).toHaveBeenCalledWith({ tenantId: TENANT_ID });
  });

  it("syncs subscription state through the billing service", async () => {
    mocks.syncTenantSubscriptionFromCatalog.mockResolvedValue({
      subscriptionId: "subscription-1",
      prorationAmountCent: 100
    });

    const response = await POST(request({ action: "sync_subscription" }), params());

    expect(response.status).toBe(200);
    expect(mocks.syncTenantSubscriptionFromCatalog).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      actorUserId: USER_ID
    });
  });

  it("creates audited billing adjustments for internal staff", async () => {
    mocks.createBillingAdjustment.mockResolvedValue({ id: "adjustment-1" });

    const response = await POST(
      request({
        action: "create_adjustment",
        adjustmentType: "credit",
        amountCent: 5000,
        reason: "Launch service credit"
      }),
      params()
    );

    expect(response.status).toBe(200);
    expect(mocks.createBillingAdjustment).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      adjustmentType: "credit",
      amountCent: 5000,
      reason: "Launch service credit",
      sourceInvoiceId: null,
      actorUserId: USER_ID,
      metadata: null
    });
  });

  it("transitions invoice status through the lifecycle service", async () => {
    mocks.transitionInvoiceStatus.mockResolvedValue({ id: "cccccccc-cccc-cccc-cccc-cccccccccccc" });

    const response = await POST(
      request({
        action: "transition_invoice",
        invoiceId: "cccccccc-cccc-cccc-cccc-cccccccccccc",
        status: "paid",
        reason: "Provider payment confirmed"
      }),
      params()
    );

    expect(response.status).toBe(200);
    expect(mocks.transitionInvoiceStatus).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      invoiceId: "cccccccc-cccc-cccc-cccc-cccccccccccc",
      status: "paid",
      reason: "Provider payment confirmed",
      actorUserId: USER_ID
    });
  });
});
