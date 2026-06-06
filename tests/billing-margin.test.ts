import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dbQuery: vi.fn()
}));

vi.mock("@/server/db", () => ({
  db: {
    query: mocks.dbQuery
  }
}));

import { getTenantMarginSnapshot } from "@/server/billing/margin";

describe("getTenantMarginSnapshot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("aggregates module cost and estimated revenue", async () => {
    mocks.dbQuery.mockResolvedValue({
      rows: [
        {
          module_key: "email",
          usage_kind: "outbound_email",
          provider_mode: null,
          quantity_total: 10,
          cost_total_cent: 30,
          event_count: 10
        },
        {
          module_key: "email",
          usage_kind: "direct_send",
          provider_mode: null,
          quantity_total: 10,
          cost_total_cent: 0,
          event_count: 10
        },
        {
          module_key: "voice",
          usage_kind: "outbound_call",
          provider_mode: null,
          quantity_total: 2,
          cost_total_cent: 100,
          event_count: 2
        },
        {
          module_key: "aiAutomation",
          usage_kind: "transcript_analysis",
          provider_mode: "managed",
          quantity_total: 1200,
          cost_total_cent: 25,
          event_count: 1
        }
      ]
    });

    const snapshot = await getTenantMarginSnapshot({
      tenantId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      windowDays: 30
    });

    expect(snapshot.totals.events).toBe(23);
    expect(snapshot.totals.costCent).toBe(155);
    expect(snapshot.totals.estimatedRevenueCent).toBe(310);
    expect(snapshot.modules.find((row) => row.moduleKey === "email")?.estimatedRevenueCent).toBe(50);
    expect(snapshot.modules.find((row) => row.moduleKey === "voice")?.estimatedRevenueCent).toBe(135);
    expect(snapshot.modules.find((row) => row.moduleKey === "aiAutomation")?.estimatedRevenueCent).toBe(125);
  });
});
