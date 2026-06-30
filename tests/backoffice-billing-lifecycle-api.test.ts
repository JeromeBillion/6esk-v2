import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  isInternalStaff: vi.fn(),
  hasPrivilegedMfaSession: vi.fn(),
  getTenantById: vi.fn(),
  getTenantBillingLifecycleSnapshot: vi.fn(),
  syncTenantSubscriptionFromCatalog: vi.fn(),
  createBillingAdjustment: vi.fn(),
  createInvoiceDraft: vi.fn(),
  transitionInvoiceStatus: vi.fn(),
  recordCollectionEvent: vi.fn(),
  isBillingActionIdempotencyError: vi.fn()
}));

vi.mock("@/server/auth/session", () => ({
  getSessionUser: mocks.getSessionUser
}));

vi.mock("@/server/auth/roles", () => ({
  isInternalStaff: mocks.isInternalStaff
}));

vi.mock("@/server/auth/privileged-access", () => ({
  hasPrivilegedMfaSession: mocks.hasPrivilegedMfaSession
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
  recordCollectionEvent: mocks.recordCollectionEvent,
  isBillingActionIdempotencyError: mocks.isBillingActionIdempotencyError
}));

import { GET, POST } from "@/app/api/backoffice/billing/[tenantId]/route";

const TENANT_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const USER_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const IDEMPOTENCY_KEY = "billing-action-key-1";

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
    mocks.hasPrivilegedMfaSession.mockReturnValue(true);
    mocks.getTenantById.mockResolvedValue({ id: TENANT_ID, slug: "acme", status: "active" });
    mocks.getTenantBillingLifecycleSnapshot.mockResolvedValue({ tenantId: TENANT_ID });
    mocks.isBillingActionIdempotencyError.mockImplementation((error: unknown) =>
      Boolean(
        error &&
          typeof error === "object" &&
          (error as { name?: string }).name === "BillingActionIdempotencyError"
      )
    );
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

    const response = await POST(
      request({ action: "sync_subscription", idempotencyKey: IDEMPOTENCY_KEY }),
      params()
    );

    expect(response.status).toBe(200);
    expect(mocks.syncTenantSubscriptionFromCatalog).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      actorUserId: USER_ID,
      idempotencyKey: IDEMPOTENCY_KEY,
      idempotencyPayload: { action: "sync_subscription" }
    });
  });

  it("requires an idempotency key for billing mutations", async () => {
    const response = await POST(request({ action: "sync_subscription" }), params());

    expect(response.status).toBe(400);
    expect(mocks.syncTenantSubscriptionFromCatalog).not.toHaveBeenCalled();
  });

  it("requires MFA before changing billing lifecycle state", async () => {
    mocks.hasPrivilegedMfaSession.mockReturnValue(false);

    const response = await POST(
      request({ action: "sync_subscription", idempotencyKey: IDEMPOTENCY_KEY }),
      params()
    );

    expect(response.status).toBe(403);
    expect(mocks.syncTenantSubscriptionFromCatalog).not.toHaveBeenCalled();
  });

  it("creates audited billing adjustments for internal staff", async () => {
    mocks.createBillingAdjustment.mockResolvedValue({ id: "adjustment-1" });

    const response = await POST(
      request({
        action: "create_adjustment",
        idempotencyKey: IDEMPOTENCY_KEY,
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
      metadata: null,
      idempotencyKey: IDEMPOTENCY_KEY,
      idempotencyPayload: {
        action: "create_adjustment",
        adjustmentType: "credit",
        amountCent: 5000,
        reason: "Launch service credit"
      }
    });
  });

  it("rejects zero-value billing adjustments before service calls", async () => {
    const response = await POST(
      request({
        action: "create_adjustment",
        idempotencyKey: IDEMPOTENCY_KEY,
        adjustmentType: "credit",
        amountCent: 0,
        reason: "No-op adjustment"
      }),
      params()
    );

    expect(response.status).toBe(400);
    expect(mocks.createBillingAdjustment).not.toHaveBeenCalled();
  });

  it("returns duplicate billing action replay as deduplicated success", async () => {
    mocks.createBillingAdjustment.mockRejectedValue({
      name: "BillingActionIdempotencyError",
      code: "idempotency_replay",
      message: "Billing action already completed.",
      response: { id: "adjustment-1" }
    });

    const response = await POST(
      request({
        action: "create_adjustment",
        idempotencyKey: IDEMPOTENCY_KEY,
        adjustmentType: "credit",
        amountCent: 5000,
        reason: "Launch service credit"
      }),
      params()
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      status: "ok",
      deduplicated: true,
      adjustment: { id: "adjustment-1" }
    });
  });

  it("transitions invoice status through the lifecycle service", async () => {
    mocks.transitionInvoiceStatus.mockResolvedValue({ id: "cccccccc-cccc-cccc-cccc-cccccccccccc" });

    const response = await POST(
      request({
        action: "transition_invoice",
        idempotencyKey: IDEMPOTENCY_KEY,
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
      actorUserId: USER_ID,
      idempotencyKey: IDEMPOTENCY_KEY,
      idempotencyPayload: {
        action: "transition_invoice",
        invoiceId: "cccccccc-cccc-cccc-cccc-cccccccccccc",
        status: "paid",
        reason: "Provider payment confirmed"
      }
    });
  });
});
