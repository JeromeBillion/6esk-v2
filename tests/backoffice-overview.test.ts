import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dbQuery: vi.fn(),
  getOpsHealthSnapshot: vi.fn(),
  getSecurityReadinessSnapshot: vi.fn(),
  getTenantMarginSnapshot: vi.fn()
}));

vi.mock("@/server/db", () => ({
  db: {
    query: mocks.dbQuery
  }
}));

vi.mock("@/server/ops/health", () => ({
  getOpsHealthSnapshot: mocks.getOpsHealthSnapshot
}));

vi.mock("@/server/security/readiness", () => ({
  getSecurityReadinessSnapshot: mocks.getSecurityReadinessSnapshot
}));

vi.mock("@/server/billing/margin", () => ({
  getTenantMarginSnapshot: mocks.getTenantMarginSnapshot
}));

import { getBackofficeOverview } from "@/server/backoffice/overview";

describe("getBackofficeOverview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.dbQuery.mockResolvedValue({
      rows: [
        { status: "active", count: 4 },
        { status: "suspended", count: 1 },
        { status: "closed", count: 2 }
      ]
    });
    mocks.getOpsHealthSnapshot.mockResolvedValue({ ready: true });
    mocks.getSecurityReadinessSnapshot.mockResolvedValue({ healthy: true });
    mocks.getTenantMarginSnapshot.mockResolvedValue({ totals: { events: 10 } });
  });

  it("returns tenant, operations, security and finance overview", async () => {
    const overview = await getBackofficeOverview({ tenantId: "tenant-1" });

    expect(overview.tenants).toEqual({
      active: 4,
      suspended: 1,
      closed: 2
    });
    expect(overview.operations).toEqual({ ready: true });
    expect(overview.security).toEqual({ healthy: true });
    expect(overview.finance).toEqual({ totals: { events: 10 } });
  });
});
