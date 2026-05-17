import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  isInternalStaff: vi.fn(),
  getOpsHealthSnapshot: vi.fn()
}));

vi.mock("@/server/auth/session", () => ({
  getSessionUser: mocks.getSessionUser
}));

vi.mock("@/server/auth/roles", () => ({
  isInternalStaff: mocks.isInternalStaff
}));

vi.mock("@/server/ops/health", () => ({
  getOpsHealthSnapshot: mocks.getOpsHealthSnapshot
}));

import { GET } from "@/app/api/backoffice/ops/health/route";

describe("backoffice ops health API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 403 for non-internal users", async () => {
    mocks.getSessionUser.mockResolvedValue({ id: "u1", tenant_id: "t1" });
    mocks.isInternalStaff.mockReturnValue(false);

    const response = await GET();
    expect(response.status).toBe(403);
  });

  it("returns tenant-scoped ops health snapshot", async () => {
    mocks.getSessionUser.mockResolvedValue({ id: "u1", tenant_id: "t1" });
    mocks.isInternalStaff.mockReturnValue(true);
    mocks.getOpsHealthSnapshot.mockResolvedValue({ ready: true, tenantId: "t1" });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.getOpsHealthSnapshot).toHaveBeenCalledWith({ tenantId: "t1" });
    expect(body).toEqual({ ready: true, tenantId: "t1" });
  });
});
