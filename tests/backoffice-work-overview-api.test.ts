import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  isInternalStaff: vi.fn(),
  getBackofficeOverview: vi.fn()
}));

vi.mock("@/server/auth/session", () => ({
  getSessionUser: mocks.getSessionUser
}));

vi.mock("@/server/auth/roles", () => ({
  isInternalStaff: mocks.isInternalStaff
}));

vi.mock("@/server/backoffice/overview", () => ({
  getBackofficeOverview: mocks.getBackofficeOverview
}));

import { GET } from "@/app/api/backoffice/work/overview/route";

describe("backoffice work overview API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 403 for non-internal users", async () => {
    mocks.getSessionUser.mockResolvedValue({ id: "u1", tenant_id: "t1" });
    mocks.isInternalStaff.mockReturnValue(false);

    const response = await GET(new Request("http://localhost/api/backoffice/work/overview"));
    expect(response.status).toBe(403);
  });

  it("returns backoffice overview for internal users", async () => {
    mocks.getSessionUser.mockResolvedValue({ id: "u1", tenant_id: "t1" });
    mocks.isInternalStaff.mockReturnValue(true);
    mocks.getBackofficeOverview.mockResolvedValue({ tenantScope: "t1", tenants: { active: 3 } });

    const response = await GET(new Request("http://localhost/api/backoffice/work/overview"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.getBackofficeOverview).toHaveBeenCalledWith({ tenantId: "t1" });
    expect(body).toEqual({ tenantScope: "t1", tenants: { active: 3 } });
  });
});
