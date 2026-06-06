import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dbQuery: vi.fn(),
  dbConnect: vi.fn(),
  clientQuery: vi.fn(),
  release: vi.fn()
}));

vi.mock("@/server/db", () => ({
  db: {
    query: mocks.dbQuery,
    connect: mocks.dbConnect
  }
}));

import {
  calculatePlanChangeProration,
  getCustomerSafeInvoiceExport,
  recordBillingPlanChange,
  recordManualBillingAdjustment,
  transitionWorkspaceBillingInvoice,
  updateBillingCollectionsState
} from "@/server/billing/lifecycle";

const SUBSCRIPTION_ID = "11111111-1111-1111-1111-111111111111";
const INVOICE_ID = "22222222-2222-2222-2222-222222222222";
const USER_ID = "33333333-3333-3333-3333-333333333333";

const baseModules = {
  email: true,
  whatsapp: false,
  voice: false,
  aiAutomation: false,
  vanillaWebchat: true
};

const plusWhatsapp = {
  ...baseModules,
  whatsapp: true
};

function subscriptionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: SUBSCRIPTION_ID,
    tenant_key: "tenant-a",
    workspace_key: "workspace-a",
    plan_key: "core_os",
    catalog_version: "v2.2026-06",
    status: "active",
    collection_status: "current",
    modules: baseModules,
    current_period_start: "2026-06-01T00:00:00.000Z",
    current_period_end: "2026-07-01T00:00:00.000Z",
    renews_at: "2026-07-01T00:00:00.000Z",
    cancel_at: null,
    canceled_at: null,
    downgrade_at: null,
    suspended_at: null,
    grace_period_ends_at: null,
    provider_customer_ref: null,
    provider_subscription_ref: null,
    metadata: {},
    created_at: "2026-06-01T00:00:00.000Z",
    updated_at: "2026-06-01T00:00:00.000Z",
    ...overrides
  };
}

function invoiceRow(overrides: Record<string, unknown> = {}) {
  return {
    id: INVOICE_ID,
    tenant_key: "tenant-a",
    workspace_key: "workspace-a",
    subscription_id: SUBSCRIPTION_ID,
    invoice_number: "INV-20260601-ABC12345",
    status: "issued",
    currency: "ZAR",
    period_start: "2026-06-01T00:00:00.000Z",
    period_end: "2026-07-01T00:00:00.000Z",
    due_at: "2026-06-15T00:00:00.000Z",
    issued_at: "2026-06-01T00:00:00.000Z",
    paid_at: null,
    voided_at: null,
    credited_at: null,
    refunded_at: null,
    written_off_at: null,
    subtotal_cents: 119800,
    vat_cents: 17970,
    total_cents: 137770,
    amount_due_cents: 137770,
    amount_paid_cents: 0,
    amount_credited_cents: 0,
    amount_refunded_cents: 0,
    amount_written_off_cents: 0,
    lines: [
      {
        sku: "core_os",
        label: "Core OS",
        description: "Base CRM workspace",
        quantity: 1,
        unitAmountCents: 119800,
        subtotalCents: 119800
      }
    ],
    metadata: {},
    created_at: "2026-06-01T00:00:00.000Z",
    updated_at: "2026-06-01T00:00:00.000Z",
    ...overrides
  };
}

describe("billing lifecycle foundation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.dbConnect.mockResolvedValue({
      query: mocks.clientQuery,
      release: mocks.release
    });
    mocks.clientQuery.mockImplementation((query: string, params?: unknown[]) => {
      if (query === "BEGIN" || query === "COMMIT" || query === "ROLLBACK") {
        return Promise.resolve({ rows: [] });
      }
      if (query.includes("FROM workspace_billing_subscriptions") && query.includes("FOR UPDATE")) {
        return Promise.resolve({ rows: [subscriptionRow()] });
      }
      if (query.includes("INSERT INTO workspace_billing_plan_changes")) {
        const calculation = JSON.parse(String(params?.[18] ?? "{}"));
        return Promise.resolve({
          rows: [
            {
              id: "44444444-4444-4444-4444-444444444444",
              tenant_key: "tenant-a",
              workspace_key: "workspace-a",
              subscription_id: SUBSCRIPTION_ID,
              change_type: params?.[3],
              status: params?.[4],
              from_plan_key: params?.[5],
              to_plan_key: params?.[6],
              from_modules: JSON.parse(String(params?.[7])),
              to_modules: JSON.parse(String(params?.[8])),
              effective_at: params?.[9],
              period_start: params?.[10],
              period_end: params?.[11],
              subtotal_delta_cents: params?.[12],
              vat_delta_cents: params?.[13],
              total_delta_cents: params?.[14],
              proration_cents: params?.[15],
              credit_cents: params?.[16],
              charge_cents: params?.[17],
              currency: "ZAR",
              calculation,
              metadata: {},
              created_at: "2026-06-16T00:00:00.000Z",
              updated_at: "2026-06-16T00:00:00.000Z"
            }
          ]
        });
      }
      if (query.includes("UPDATE workspace_billing_subscriptions")) {
        return Promise.resolve({
          rows: [
            subscriptionRow({
              modules: query.includes("modules = $5") ? plusWhatsapp : baseModules,
              status: query.includes("status = $4") ? params?.[3] : "active",
              collection_status: query.includes("collection_status = $5") ? params?.[4] : "current",
              updated_at: "2026-06-16T00:00:00.000Z"
            })
          ]
        });
      }
      if (query.includes("INSERT INTO workspace_billing_adjustments")) {
        return Promise.resolve({
          rows: [
            {
              id: "55555555-5555-5555-5555-555555555555",
              tenant_key: "tenant-a",
              workspace_key: "workspace-a",
              subscription_id: SUBSCRIPTION_ID,
              invoice_id: params?.[3] ?? null,
              adjustment_type: params?.[4],
              status: "applied",
              amount_cents: params?.[5],
              currency: "ZAR",
              reason: params?.[6],
              metadata: {},
              created_at: "2026-06-16T00:00:00.000Z",
              voided_at: null
            }
          ]
        });
      }
      if (query.includes("FROM workspace_billing_invoices") && query.includes("FOR UPDATE")) {
        return Promise.resolve({ rows: [invoiceRow()] });
      }
      if (query.includes("UPDATE workspace_billing_invoices") && query.includes("status = $4")) {
        return Promise.resolve({
          rows: [
            invoiceRow({
              status: params?.[3],
              amount_due_cents: params?.[3] === "paid" ? 0 : 137770,
              amount_paid_cents: params?.[3] === "paid" ? 137770 : 0,
              paid_at: params?.[3] === "paid" ? "2026-06-16T00:00:00.000Z" : null
            })
          ]
        });
      }
      if (query.includes("UPDATE workspace_billing_invoices")) {
        return Promise.resolve({
          rows: [
            invoiceRow({
              status: "credited",
              amount_due_cents: 127770,
              amount_credited_cents: 10000,
              credited_at: "2026-06-16T00:00:00.000Z"
            })
          ]
        });
      }
      if (query.includes("INSERT INTO workspace_billing_dunning_events")) {
        return Promise.resolve({
          rows: [
            {
              id: "66666666-6666-6666-6666-666666666666",
              tenant_key: "tenant-a",
              workspace_key: "workspace-a",
              subscription_id: SUBSCRIPTION_ID,
              invoice_id: params?.[3] ?? null,
              event_type: params?.[4],
              from_collection_status: params?.[5],
              to_collection_status: params?.[6],
              reason: params?.[7],
              retry_at: params?.[8] ?? null,
              metadata: {},
              created_at: "2026-06-16T00:00:00.000Z"
            }
          ]
        });
      }
      return Promise.resolve({ rows: [] });
    });
  });

  it("calculates deterministic proration without provider calls", () => {
    const calculation = calculatePlanChangeProration({
      fromModules: baseModules,
      toModules: plusWhatsapp,
      periodStart: "2026-06-01T00:00:00.000Z",
      periodEnd: "2026-07-01T00:00:00.000Z",
      effectiveAt: "2026-06-16T00:00:00.000Z",
      vatRatePercent: 15
    });

    expect(calculation.remainingRatio).toBe(0.5);
    expect(calculation.subtotalDeltaCents).toBe(49900);
    expect(calculation.totalDeltaCents).toBe(57385);
    expect(calculation.chargeCents).toBe(28693);
    expect(calculation.creditCents).toBe(0);
  });

  it("records an audited plan change and syncs entitlements", async () => {
    const result = await recordBillingPlanChange({
      tenantKey: "tenant-a",
      workspaceKey: "workspace-a",
      actor: { userId: USER_ID },
      toModules: plusWhatsapp,
      effectiveAt: "2026-06-02T00:00:00.000Z"
    });

    expect(result.change.chargeCents).toBeGreaterThan(0);
    expect(mocks.clientQuery).toHaveBeenCalledWith("BEGIN");
    expect(mocks.clientQuery).toHaveBeenCalledWith("COMMIT");
    const moduleUpsert = mocks.clientQuery.mock.calls.find(([query]) =>
      String(query).includes("INSERT INTO workspace_modules")
    );
    expect(moduleUpsert?.[1]?.[0]).toBe("tenant-a");
    expect(moduleUpsert?.[1]?.[1]).toBe("workspace-a");
    expect(JSON.parse(String(moduleUpsert?.[1]?.[2])).whatsapp.status).toBe("active");
    const auditInsert = mocks.clientQuery.mock.calls.find(([query]) =>
      String(query).includes("INSERT INTO audit_logs")
    );
    expect(auditInsert?.[1]).toEqual(
      expect.arrayContaining(["tenant-a", "workspace-a", USER_ID, "billing_plan_change_recorded"])
    );
  });

  it("records manual credits and updates the scoped invoice", async () => {
    const result = await recordManualBillingAdjustment({
      tenantKey: "tenant-a",
      workspaceKey: "workspace-a",
      actor: { userId: USER_ID },
      invoiceId: INVOICE_ID,
      adjustmentType: "credit",
      amountCents: 10000,
      reason: "Service credit approved"
    });

    expect(result.adjustment.adjustmentType).toBe("credit");
    expect(result.invoice?.status).toBe("credited");
    expect(result.invoice?.amountDueCents).toBe(127770);
    const invoiceSelect = mocks.clientQuery.mock.calls.find(([query]) =>
      String(query).includes("FROM workspace_billing_invoices") && String(query).includes("FOR UPDATE")
    );
    expect(invoiceSelect?.[1]).toEqual(["tenant-a", "workspace-a", SUBSCRIPTION_ID, INVOICE_ID]);
  });

  it("transitions invoice lifecycle states inside tenant scope", async () => {
    const invoice = await transitionWorkspaceBillingInvoice({
      tenantKey: "tenant-a",
      workspaceKey: "workspace-a",
      actor: { userId: USER_ID },
      invoiceId: INVOICE_ID,
      status: "paid",
      reason: "Payment received"
    });

    expect(invoice.status).toBe("paid");
    expect(invoice.amountDueCents).toBe(0);
    const invoiceSelect = mocks.clientQuery.mock.calls.find(([query]) =>
      String(query).includes("FROM workspace_billing_invoices") && String(query).includes("FOR UPDATE")
    );
    expect(invoiceSelect?.[1]).toEqual(["tenant-a", "workspace-a", INVOICE_ID]);
    const invoiceUpdate = mocks.clientQuery.mock.calls.find(([query]) =>
      String(query).includes("UPDATE workspace_billing_invoices") && String(query).includes("status = $4")
    );
    expect(invoiceUpdate?.[1]).toEqual(
      expect.arrayContaining(["tenant-a", "workspace-a", INVOICE_ID, "paid", USER_ID])
    );
  });

  it("suspends collections and disables module entitlements", async () => {
    const result = await updateBillingCollectionsState({
      tenantKey: "tenant-a",
      workspaceKey: "workspace-a",
      actor: { userId: USER_ID },
      collectionStatus: "suspended",
      reason: "Dunning grace period expired"
    });

    expect(result.subscription.collectionStatus).toBe("suspended");
    const moduleUpsert = mocks.clientQuery.mock.calls.find(([query]) =>
      String(query).includes("INSERT INTO workspace_modules")
    );
    const entitlements = JSON.parse(String(moduleUpsert?.[1]?.[2]));
    expect(entitlements.email.status).toBe("suspended");
    expect(entitlements.email.enabled).toBe(false);
  });

  it("exports customer-safe invoice data scoped to tenant and workspace", async () => {
    mocks.dbQuery.mockResolvedValue({
      rows: [invoiceRow({ plan_key: "core_os" })]
    });

    const payload = await getCustomerSafeInvoiceExport({
      tenantKey: "tenant-a",
      workspaceKey: "workspace-a",
      invoiceId: INVOICE_ID
    });

    expect(payload).toMatchObject({
      formatVersion: "workspace-invoice-export.v1",
      workspaceKey: "workspace-a",
      invoice: {
        id: INVOICE_ID,
        planKey: "core_os",
        totalCents: 137770
      }
    });
    expect(JSON.stringify(payload)).not.toContain("tenant-a");
    expect(mocks.dbQuery).toHaveBeenCalledWith(
      expect.stringContaining("invoice.tenant_key = $1"),
      ["tenant-a", "workspace-a", INVOICE_ID]
    );
  });
});
