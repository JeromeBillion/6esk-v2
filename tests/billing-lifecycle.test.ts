import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dbQuery: vi.fn(),
  dbConnect: vi.fn(),
  recordAuditLog: vi.fn()
}));

vi.mock("@/server/db", () => ({
  db: {
    query: mocks.dbQuery,
    connect: mocks.dbConnect
  }
}));

vi.mock("@/server/audit", () => ({
  recordAuditLog: mocks.recordAuditLog
}));

import {
  buildCatalogSubscriptionItems,
  calculateProrationCent,
  createBillingAdjustment,
  createInvoiceDraft,
  getCustomerSafeInvoiceExport,
  getTenantBillingLifecycleSnapshot,
  syncTenantSubscriptionFromCatalog
} from "@/server/billing/lifecycle";

const TENANT_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const USER_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

const modules = {
  email: true,
  whatsapp: true,
  voice: false,
  aiAutomation: true,
  dexterOrchestration: false,
  vanillaWebchat: true
};

describe("billing lifecycle service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.recordAuditLog.mockResolvedValue(undefined);
  });

  it("builds subscription items from the v2 modular pricing catalog", () => {
    const items = buildCatalogSubscriptionItems({
      modules,
      aiMode: "byo"
    });

    expect(items.map((item) => item.itemKey)).toEqual([
      "core_os",
      "module:whatsapp",
      "module:aiAutomation"
    ]);
    expect(items.reduce((total, item) => total + item.amountCent, 0)).toBe(209700);
  });

  it("calculates mid-period proration from old and new subscription totals", () => {
    const proration = calculateProrationCent({
      previousAmountCent: 119800,
      nextAmountCent: 209700,
      periodStart: new Date("2026-06-01T00:00:00.000Z"),
      periodEnd: new Date("2026-07-01T00:00:00.000Z"),
      effectiveAt: new Date("2026-06-16T00:00:00.000Z")
    });

    expect(proration).toBe(44950);
  });

  it("estimates invoice totals from catalog subscription, usage, credits, and VAT", async () => {
    mocks.dbQuery
      .mockResolvedValueOnce({
        rows: [
          {
            id: TENANT_ID,
            slug: "acme",
            display_name: "Acme",
            plan: "standard",
            status: "active",
            settings: { aiProviderMode: "byo" },
            modules
          }
        ]
      })
      .mockResolvedValueOnce({
        rows: [
          {
            tenant_id: TENANT_ID,
            workspace_key: "primary",
            currency: "ZAR",
            vat_rate_bps: 1500,
            payment_terms_days: 7,
            invoice_prefix: "6ESK-",
            next_invoice_sequence: 1,
            collection_status: "current",
            dunning_status: "none",
            billing_email: "billing@acme.example"
          }
        ]
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            module_key: "email",
            usage_kind: "outbound_email",
            provider_mode: null,
            quantity_total: 10,
            cost_total_cent: 0,
            event_count: 10
          }
        ]
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
            adjustment_type: "credit",
            amount_cent: -100,
            currency: "ZAR",
            reason: "Launch credit",
            status: "pending",
            source_invoice_id: null,
            created_at: "2026-06-06T10:00:00.000Z"
          }
        ]
      })
      .mockResolvedValueOnce({ rows: [] });

    const snapshot = await getTenantBillingLifecycleSnapshot({
      tenantId: TENANT_ID,
      periodStart: new Date("2026-06-01T00:00:00.000Z"),
      periodEnd: new Date("2026-07-01T00:00:00.000Z")
    });

    expect(snapshot.subscription.source).toBe("catalog_current_modules");
    expect(snapshot.estimatedInvoice.subtotalCent).toBe(209700);
    expect(snapshot.estimatedInvoice.usageCent).toBe(50);
    expect(snapshot.estimatedInvoice.adjustmentCent).toBe(-100);
    expect(snapshot.estimatedInvoice.taxCent).toBe(31448);
    expect(snapshot.estimatedInvoice.totalCent).toBe(241098);
  });

  it("normalizes manual credits as negative audited adjustments", async () => {
    mocks.dbQuery
      .mockResolvedValueOnce({
        rows: [
          {
            tenant_id: TENANT_ID,
            workspace_key: "primary",
            currency: "ZAR",
            vat_rate_bps: 0,
            payment_terms_days: 7,
            invoice_prefix: "6ESK-",
            next_invoice_sequence: 1,
            collection_status: "current",
            dunning_status: "none",
            billing_email: null
          }
        ]
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "adjustment-1",
            adjustment_type: "credit",
            amount_cent: -5000,
            currency: "ZAR",
            reason: "Service credit",
            status: "pending",
            source_invoice_id: null,
            created_at: "2026-06-06T10:00:00.000Z"
          }
        ]
      });

    const adjustment = await createBillingAdjustment({
      tenantId: TENANT_ID,
      adjustmentType: "credit",
      amountCent: 5000,
      reason: "Service credit",
      actorUserId: USER_ID
    });

    expect(adjustment.amount_cent).toBe(-5000);
    expect(mocks.dbQuery.mock.calls[1][1]).toEqual(
      expect.arrayContaining(["credit", -5000, "Service credit"])
    );
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT_ID,
        actorUserId: USER_ID,
        action: "tenant_billing_adjustment_created"
      })
    );
  });

  it("syncs subscription items and records proration for a mid-period module change", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql === "BEGIN" || sql === "COMMIT") return { rows: [] };
      if (sql.includes("FROM tenants t")) {
        return {
          rows: [
            {
              id: TENANT_ID,
              slug: "acme",
              display_name: "Acme",
              plan: "standard",
              status: "active",
              settings: { aiProviderMode: "byo" },
              modules
            }
          ]
        };
      }
      if (sql.includes("INSERT INTO tenant_billing_accounts")) {
        return {
          rows: [
            {
              tenant_id: TENANT_ID,
              workspace_key: "primary",
              currency: "ZAR",
              vat_rate_bps: 0,
              payment_terms_days: 7,
              invoice_prefix: "6ESK-",
              next_invoice_sequence: 1,
              collection_status: "current",
              dunning_status: "none",
              billing_email: null
            }
          ]
        };
      }
      if (sql.includes("FROM tenant_subscriptions") && sql.includes("FOR UPDATE")) {
        return {
          rows: [
            {
              id: "subscription-1",
              tenant_id: TENANT_ID,
              workspace_key: "primary",
              status: "active",
              plan_id: "standard",
              billing_interval: "month",
              current_period_start: new Date("2026-06-01T00:00:00.000Z"),
              current_period_end: new Date("2026-07-01T00:00:00.000Z"),
              cancel_at_period_end: false,
              provider: null,
              provider_subscription_id: null
            }
          ]
        };
      }
      if (sql.includes("FROM tenant_subscription_items")) {
        return {
          rows: [
            {
              id: "item-1",
              item_key: "core_os",
              item_kind: "base",
              module_key: null,
              display_name: "Core OS",
              quantity: 1,
              unit_amount_cent: 69900,
              currency: "ZAR",
              pricing_source: "catalog"
            }
          ]
        };
      }
      return { rows: [] };
    });
    mocks.dbConnect.mockResolvedValue({ query, release: vi.fn() });

    const result = await syncTenantSubscriptionFromCatalog({
      tenantId: TENANT_ID,
      actorUserId: USER_ID,
      effectiveAt: new Date("2026-06-16T00:00:00.000Z")
    });

    expect(result.subscriptionId).toBe("subscription-1");
    expect(result.items).toHaveLength(3);
    expect(result.prorationAmountCent).toBe(69900);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO tenant_billing_adjustments"),
      expect.arrayContaining([TENANT_ID, "primary", 69900])
    );
  });

  it("rejects duplicate active invoice drafts for the same billing period", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql === "BEGIN" || sql === "ROLLBACK") return { rows: [] };
      if (sql.includes("INSERT INTO tenant_billing_accounts")) {
        return {
          rows: [
            {
              tenant_id: TENANT_ID,
              workspace_key: "primary",
              currency: "ZAR",
              vat_rate_bps: 0,
              payment_terms_days: 7,
              invoice_prefix: "6ESK-",
              next_invoice_sequence: 4,
              collection_status: "current",
              dunning_status: "none",
              billing_email: null
            }
          ]
        };
      }
      if (sql.includes("FROM tenants t")) {
        return {
          rows: [
            {
              id: TENANT_ID,
              slug: "acme",
              display_name: "Acme",
              plan: "standard",
              status: "active",
              settings: { aiProviderMode: "managed" },
              modules
            }
          ]
        };
      }
      if (sql.includes("FROM tenant_billing_accounts")) {
        return {
          rows: [
            {
              tenant_id: TENANT_ID,
              workspace_key: "primary",
              currency: "ZAR",
              vat_rate_bps: 0,
              payment_terms_days: 7,
              invoice_prefix: "6ESK-",
              next_invoice_sequence: 4,
              collection_status: "current",
              dunning_status: "none",
              billing_email: null
            }
          ]
        };
      }
      if (sql.includes("FROM tenant_subscriptions")) return { rows: [] };
      if (sql.includes("FROM workspace_module_usage_events")) return { rows: [] };
      if (sql.includes("FROM tenant_billing_adjustments")) return { rows: [] };
      if (sql.includes("FROM tenant_invoices") && sql.includes("LIMIT 12")) return { rows: [] };
      if (sql.includes("FROM tenant_invoices") && sql.includes("status IN ('draft', 'open', 'paid', 'uncollectible')")) {
        return {
          rows: [
            {
              id: "dddddddd-dddd-dddd-dddd-dddddddddddd",
              invoice_number: "6ESK-202606-000003",
              status: "draft",
              currency: "ZAR",
              period_start: "2026-06-01T00:00:00.000Z",
              period_end: "2026-07-01T00:00:00.000Z",
              subtotal_cent: 0,
              usage_cent: 0,
              adjustment_cent: 0,
              tax_cent: 0,
              total_cent: 0,
              amount_due_cent: 0,
              due_at: null,
              issued_at: null,
              paid_at: null,
              voided_at: null,
              created_at: "2026-06-06T10:00:00.000Z"
            }
          ]
        };
      }
      return { rows: [] };
    });
    mocks.dbConnect.mockResolvedValue({ query, release: vi.fn() });

    await expect(
      createInvoiceDraft({
        tenantId: TENANT_ID,
        actorUserId: USER_ID,
        periodStart: new Date("2026-06-01T00:00:00.000Z"),
        periodEnd: new Date("2026-07-01T00:00:00.000Z")
      })
    ).rejects.toThrow("An active invoice already exists for this billing period.");

    expect(query).toHaveBeenCalledWith("ROLLBACK");
    expect(query).not.toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO tenant_invoices"),
      expect.anything()
    );
    expect(mocks.recordAuditLog).not.toHaveBeenCalled();
  });

  it("exports customer-safe invoice data inside tenant and workspace scope", async () => {
    const invoiceId = "dddddddd-dddd-dddd-dddd-dddddddddddd";
    mocks.dbQuery
      .mockResolvedValueOnce({
        rows: [
          {
            id: invoiceId,
            invoice_number: "6ESK-202606-000004",
            status: "open",
            currency: "ZAR",
            period_start: "2026-06-01T00:00:00.000Z",
            period_end: "2026-07-01T00:00:00.000Z",
            subtotal_cent: 69900,
            usage_cent: 150,
            adjustment_cent: 0,
            tax_cent: 10508,
            total_cent: 80558,
            amount_due_cent: 80558,
            due_at: "2026-07-08T00:00:00.000Z",
            issued_at: "2026-07-01T00:00:00.000Z",
            paid_at: null,
            voided_at: null,
            created_at: "2026-07-01T00:00:00.000Z",
            plan_id: "standard"
          }
        ]
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "line-1",
            line_type: "usage",
            module_key: "email",
            usage_kind: "outbound_email",
            description: "Email usage: outbound_email",
            quantity: "30",
            unit_amount_cent: 5,
            amount_cent: 150,
            currency: "ZAR"
          }
        ]
      });

    const invoiceExport = await getCustomerSafeInvoiceExport({
      tenantId: TENANT_ID,
      invoiceId
    });

    expect(invoiceExport).toMatchObject({
      formatVersion: "workspace-invoice-export.v1",
      workspaceKey: "primary",
      invoice: {
        id: invoiceId,
        invoiceNumber: "6ESK-202606-000004",
        planId: "standard",
        totalCent: 80558,
        lines: [
          {
            lineType: "usage",
            moduleKey: "email",
            usageKind: "outbound_email",
            amountCent: 150
          }
        ]
      }
    });
    expect(mocks.dbQuery.mock.calls[0][1]).toEqual([TENANT_ID, "primary", invoiceId]);
    expect(mocks.dbQuery.mock.calls[1][1]).toEqual([TENANT_ID, "primary", invoiceId]);
    expect(JSON.stringify(invoiceExport)).not.toContain(TENANT_ID);
  });
});
