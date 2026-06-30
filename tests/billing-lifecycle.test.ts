import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dbQuery: vi.fn(),
  dbConnect: vi.fn(),
  clientQuery: vi.fn(),
  clientRelease: vi.fn(),
  recordAuditLogWithClient: vi.fn()
}));

vi.mock("@/server/db", () => ({
  db: {
    query: mocks.dbQuery,
    connect: mocks.dbConnect
  }
}));

vi.mock("@/server/audit", () => ({
  recordAuditLogWithClient: mocks.recordAuditLogWithClient
}));

import {
  buildCatalogSubscriptionItems,
  calculateProrationCent,
  createBillingAdjustment,
  createInvoiceDraft,
  getCustomerSafeInvoiceExport,
  getTenantBillingLifecycleSnapshot,
  recordCollectionEvent,
  syncTenantSubscriptionFromCatalog,
  transitionInvoiceStatus
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
    mocks.dbConnect.mockResolvedValue({
      query: mocks.clientQuery,
      release: mocks.clientRelease
    });
    mocks.clientQuery.mockResolvedValue({ rows: [] });
    mocks.recordAuditLogWithClient.mockResolvedValue(undefined);
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
    mocks.clientQuery
      .mockResolvedValueOnce({ rows: [] })
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
    expect(mocks.clientQuery.mock.calls[2][1]).toEqual(
      expect.arrayContaining(["credit", -5000, "Service credit"])
    );
    expect(mocks.recordAuditLogWithClient).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        tenantId: TENANT_ID,
        actorUserId: USER_ID,
        action: "tenant_billing_adjustment_created"
      })
    );
  });

  it("rejects adjustment source invoices outside the tenant workspace before writes", async () => {
    const sourceInvoiceId = "dddddddd-dddd-dddd-dddd-dddddddddddd";
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
              next_invoice_sequence: 1,
              collection_status: "current",
              dunning_status: "none",
              billing_email: null
            }
          ]
        };
      }
      if (sql.includes("FROM tenant_invoices") && sql.includes("id = $3")) {
        return { rows: [] };
      }
      return { rows: [] };
    });
    mocks.dbConnect.mockResolvedValue({ query, release: vi.fn() });

    await expect(
      createBillingAdjustment({
        tenantId: TENANT_ID,
        adjustmentType: "credit",
        amountCent: 5000,
        reason: "Invoice-linked credit",
        sourceInvoiceId,
        actorUserId: USER_ID,
        idempotencyKey: "billing-adjustment-key-1",
        idempotencyPayload: { action: "create_adjustment", sourceInvoiceId }
      })
    ).rejects.toThrow("Source invoice was not found for this tenant workspace.");

    expect(query).toHaveBeenCalledWith("ROLLBACK");
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("FROM tenant_invoices"),
      [TENANT_ID, "primary", sourceInvoiceId]
    );
    expect(query).not.toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO tenant_billing_adjustments"),
      expect.anything()
    );
    expect(query).not.toHaveBeenCalledWith(
      expect.stringContaining("tenant_billing_action_idempotency"),
      expect.anything()
    );
    expect(mocks.recordAuditLogWithClient).not.toHaveBeenCalled();
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
    expect(mocks.recordAuditLogWithClient).not.toHaveBeenCalled();
  });

  it("opens draft invoices only when the current status allows the transition", async () => {
    const invoiceId = "dddddddd-dddd-dddd-dddd-dddddddddddd";
    const query = vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql === "BEGIN" || sql === "COMMIT") return { rows: [] };
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
      if (sql.includes("SELECT status") && sql.includes("FOR UPDATE")) {
        return { rows: [{ status: "draft", invoice_number: "6ESK-202606-000004" }] };
      }
      if (sql.includes("UPDATE tenant_invoices i")) {
        expect(sql).toContain("AND i.status = $5");
        expect(params).toEqual([invoiceId, TENANT_ID, "primary", "open", "draft"]);
        return {
          rows: [
            {
              id: invoiceId,
              invoice_number: "6ESK-202606-000004",
              status: "open",
              currency: "ZAR",
              period_start: "2026-06-01T00:00:00.000Z",
              period_end: "2026-07-01T00:00:00.000Z",
              subtotal_cent: 69900,
              usage_cent: 0,
              adjustment_cent: 0,
              tax_cent: 0,
              total_cent: 69900,
              amount_due_cent: 69900,
              due_at: "2026-07-08T00:00:00.000Z",
              issued_at: "2026-07-01T00:00:00.000Z",
              paid_at: null,
              voided_at: null,
              created_at: "2026-07-01T00:00:00.000Z"
            }
          ]
        };
      }
      return { rows: [] };
    });
    mocks.dbConnect.mockResolvedValue({ query, release: vi.fn() });

    const invoice = await transitionInvoiceStatus({
      tenantId: TENANT_ID,
      invoiceId,
      status: "open",
      actorUserId: USER_ID,
      reason: "Issue invoice"
    });

    expect(invoice.status).toBe("open");
    expect(query).toHaveBeenCalledWith("COMMIT");
  });

  it("rejects illegal invoice status transitions and audits the attempt", async () => {
    const invoiceId = "dddddddd-dddd-dddd-dddd-dddddddddddd";
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
      if (sql.includes("SELECT status") && sql.includes("FOR UPDATE")) {
        return { rows: [{ status: "paid", invoice_number: "6ESK-202606-000004" }] };
      }
      return { rows: [] };
    });
    mocks.dbConnect.mockResolvedValue({ query, release: vi.fn() });

    await expect(
      transitionInvoiceStatus({
        tenantId: TENANT_ID,
        invoiceId,
        status: "open",
        actorUserId: USER_ID,
        reason: "Undo payment"
      })
    ).rejects.toThrow("Invoice status cannot transition from paid to open.");

    expect(query).not.toHaveBeenCalledWith(expect.stringContaining("UPDATE tenant_invoices i"), expect.anything());
    expect(mocks.recordAuditLogWithClient).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tenantId: TENANT_ID,
        action: "tenant_invoice_transition_rejected",
        entityId: invoiceId,
        data: expect.objectContaining({
          currentStatus: "paid",
          requestedStatus: "open"
        })
      })
    );
    expect(query).toHaveBeenCalledWith("ROLLBACK");
  });

  it("rejects collection events for invoices outside the tenant workspace before writes", async () => {
    const invoiceId = "dddddddd-dddd-dddd-dddd-dddddddddddd";
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
              next_invoice_sequence: 1,
              collection_status: "current",
              dunning_status: "none",
              billing_email: null
            }
          ]
        };
      }
      if (sql.includes("FROM tenant_invoices") && sql.includes("id = $3")) {
        return { rows: [] };
      }
      return { rows: [] };
    });
    mocks.dbConnect.mockResolvedValue({ query, release: vi.fn() });

    await expect(
      recordCollectionEvent({
        tenantId: TENANT_ID,
        invoiceId,
        eventType: "payment_failed",
        status: "failed",
        actorUserId: USER_ID,
        idempotencyKey: "collection-event-key-1",
        idempotencyPayload: { action: "record_collection_event", invoiceId }
      })
    ).rejects.toThrow("Collection event invoice was not found for this tenant workspace.");

    expect(query).toHaveBeenCalledWith("ROLLBACK");
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("FROM tenant_invoices"),
      [TENANT_ID, "primary", invoiceId]
    );
    expect(query).not.toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO tenant_collection_events"),
      expect.anything()
    );
    expect(query).not.toHaveBeenCalledWith(
      expect.stringContaining("tenant_billing_action_idempotency"),
      expect.anything()
    );
    expect(mocks.recordAuditLogWithClient).not.toHaveBeenCalled();
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
