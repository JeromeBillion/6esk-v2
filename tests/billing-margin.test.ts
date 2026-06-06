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
          usage_kind: "reply_sent",
          quantity_total: 10,
          cost_total_cent: 30,
          event_count: 10
        },
        {
          module_key: "voice",
          usage_kind: "outbound_call",
          quantity_total: 2,
          cost_total_cent: 100,
          event_count: 2
        }
      ]
    });

    const snapshot = await getTenantMarginSnapshot({
      tenantId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      windowDays: 30
    });

    expect(snapshot.totals.events).toBe(12);
    expect(snapshot.totals.costCent).toBe(130);
    expect(snapshot.totals.estimatedRevenueCent).toBe(700);
    expect(snapshot.modules.find((row) => row.moduleKey === "email")?.estimatedRevenueCent).toBe(200);
  });
});
