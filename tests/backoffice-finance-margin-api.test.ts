import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  isInternalStaff: vi.fn(),
  getTenantMarginSnapshot: vi.fn()
}));

vi.mock("@/server/auth/session", () => ({
  getSessionUser: mocks.getSessionUser
}));

vi.mock("@/server/auth/roles", () => ({
  isInternalStaff: mocks.isInternalStaff
}));

vi.mock("@/server/billing/margin", () => ({
  getTenantMarginSnapshot: mocks.getTenantMarginSnapshot
}));

import { GET } from "@/app/api/backoffice/finance/margin/route";

describe("backoffice finance margin API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 403 for non-internal users", async () => {
    mocks.getSessionUser.mockResolvedValue({ id: "u1", tenant_id: "t1" });
    mocks.isInternalStaff.mockReturnValue(false);

    const response = await GET(new Request("http://localhost/api/backoffice/finance/margin"));
    expect(response.status).toBe(403);
  });

  it("returns margin snapshot for internal tenant context", async () => {
    mocks.getSessionUser.mockResolvedValue({ id: "u1", tenant_id: "t1" });
    mocks.isInternalStaff.mockReturnValue(true);
    mocks.getTenantMarginSnapshot.mockResolvedValue({ tenantId: "t1", totals: { events: 10 } });

    const response = await GET(
      new Request("http://localhost/api/backoffice/finance/margin?windowDays=14")
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.getTenantMarginSnapshot).toHaveBeenCalledWith({
      tenantId: "t1",
      windowDays: 14
    });
    expect(body).toEqual({ tenantId: "t1", totals: { events: 10 } });
  });
});
