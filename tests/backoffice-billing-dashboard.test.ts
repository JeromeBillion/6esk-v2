import { describe, expect, it } from "vitest";
import { buildTenantBillingFlags } from "@/server/backoffice/billing-dashboard";

const baseInput = {
  status: "active",
  billingEmail: "billing@example.com",
  estimatedRevenueCent: 100_000,
  costCent: 40_000,
  estimatedMarginCent: 60_000,
  estimatedMarginPct: 60,
  eventCount: 10,
  lastUsageAt: "2026-06-22T00:00:00.000Z",
  overdueReceivablesCent: 0,
  pendingAdjustmentCent: 0,
  pendingAdjustmentCount: 0,
  oldestPendingAdjustmentAt: null,
  collectionStatus: "current",
  dunningStatus: "none",
  failedCollectionEventCount: 0,
  missingInvoiceLineCount: 0,
  now: new Date("2026-06-23T00:00:00.000Z")
};

describe("backoffice billing dashboard risk flags", () => {
  it("flags financially risky or incomplete tenant billing evidence", () => {
    const flags = buildTenantBillingFlags({
      ...baseInput,
      billingEmail: null,
      estimatedRevenueCent: 10_000,
      costCent: 18_000,
      estimatedMarginCent: -8_000,
      estimatedMarginPct: -80,
      overdueReceivablesCent: 25_000,
      pendingAdjustmentCent: -5_000,
      pendingAdjustmentCount: 1,
      oldestPendingAdjustmentAt: "2026-06-01T00:00:00.000Z",
      collectionStatus: "collections",
      dunningStatus: "active",
      failedCollectionEventCount: 1,
      missingInvoiceLineCount: 1
    });

    expect(flags.map((flag) => flag.key)).toEqual(
      expect.arrayContaining([
        "missing_billing_email",
        "negative_margin",
        "overdue_receivables",
        "aged_pending_adjustment",
        "collections_active",
        "failed_collection_event",
        "missing_invoice_lines",
        "provider_reconciliation_pending"
      ])
    );
  });

  it("flags inactive tenants that still generate usage", () => {
    const flags = buildTenantBillingFlags({
      ...baseInput,
      status: "suspended",
      eventCount: 5
    });

    expect(flags.map((flag) => flag.key)).toContain("inactive_tenant_usage");
  });

  it("flags stale metering for active tenants with old usage evidence", () => {
    const flags = buildTenantBillingFlags({
      ...baseInput,
      lastUsageAt: "2026-06-10T00:00:00.000Z"
    });

    expect(flags.map((flag) => flag.key)).toContain("stale_metering");
  });
});
