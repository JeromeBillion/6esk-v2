import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  isInternalStaff: vi.fn(),
  getMarginSnapshot: vi.fn(),
  getTenantMarginSnapshot: vi.fn()
}));

vi.mock("@/server/auth/session", () => ({
  getSessionUser: mocks.getSessionUser
}));

vi.mock("@/server/auth/roles", () => ({
  isInternalStaff: mocks.isInternalStaff
}));

vi.mock("@/server/billing/margin", () => ({
  getMarginSnapshot: mocks.getMarginSnapshot,
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

  it("returns global margin snapshot for internal staff by default", async () => {
    mocks.getSessionUser.mockResolvedValue({ id: "u1", tenant_id: "t1" });
    mocks.isInternalStaff.mockReturnValue(true);
    mocks.getMarginSnapshot.mockResolvedValue({ scope: "global", tenantId: null, totals: { events: 10 } });

    const response = await GET(
      new Request("http://localhost/api/backoffice/finance/margin?windowDays=14")
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.getMarginSnapshot).toHaveBeenCalledWith({
      windowDays: 14
    });
    expect(mocks.getTenantMarginSnapshot).not.toHaveBeenCalled();
    expect(body).toEqual({ scope: "global", tenantId: null, totals: { events: 10 } });
  });

  it("returns tenant margin snapshot when tenantId is provided", async () => {
    mocks.getSessionUser.mockResolvedValue({ id: "u1", tenant_id: "t1" });
    mocks.isInternalStaff.mockReturnValue(true);
    mocks.getTenantMarginSnapshot.mockResolvedValue({ scope: "tenant", tenantId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", totals: { events: 5 } });

    const response = await GET(
      new Request("http://localhost/api/backoffice/finance/margin?tenantId=aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa&windowDays=7")
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.getTenantMarginSnapshot).toHaveBeenCalledWith({
      tenantId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      windowDays: 7
    });
    expect(body).toEqual({ scope: "tenant", tenantId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", totals: { events: 5 } });
  });

  it("rejects invalid tenantId filters", async () => {
    mocks.getSessionUser.mockResolvedValue({ id: "u1", tenant_id: "t1" });
    mocks.isInternalStaff.mockReturnValue(true);

    const response = await GET(
      new Request("http://localhost/api/backoffice/finance/margin?tenantId=not-a-uuid")
    );

    expect(response.status).toBe(400);
    expect(mocks.getMarginSnapshot).not.toHaveBeenCalled();
    expect(mocks.getTenantMarginSnapshot).not.toHaveBeenCalled();
  });
});
