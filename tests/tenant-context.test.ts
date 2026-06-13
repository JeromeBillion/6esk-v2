import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dbQuery: vi.fn(),
  getSessionUser: vi.fn()
}));

vi.mock("@/server/db", () => ({
  db: {
    query: mocks.dbQuery
  }
}));

vi.mock("@/server/auth/session", () => ({
  getSessionUser: mocks.getSessionUser
}));

import { getTenantContext, requireTenantContext } from "@/server/tenant/context";

describe("tenant context", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when there is no authenticated user", async () => {
    mocks.getSessionUser.mockResolvedValue(null);

    await expect(getTenantContext()).resolves.toBeNull();
    expect(mocks.dbQuery).not.toHaveBeenCalled();
  });

  it("fails closed when the session has no tenant id", async () => {
    mocks.getSessionUser.mockResolvedValue({
      id: "user-1",
      tenant_id: "",
      tenant_slug: "default",
      real_tenant_id: "",
      role_name: "tenant_admin"
    });

    await expect(getTenantContext()).resolves.toBeNull();
    expect(mocks.dbQuery).not.toHaveBeenCalled();
  });

  it("resolves tenant context from the trusted session tenant", async () => {
    mocks.getSessionUser.mockResolvedValue({
      id: "user-1",
      tenant_id: "tenant-1",
      tenant_slug: "tenant-one",
      real_tenant_id: "tenant-1",
      role_name: "tenant_admin"
    });
    mocks.dbQuery.mockResolvedValue({
      rows: [{ id: "tenant-1", slug: "tenant-one", status: "active" }]
    });

    await expect(getTenantContext()).resolves.toEqual({
      tenantId: "tenant-1",
      tenantSlug: "tenant-one",
      tenantStatus: "active"
    });
    expect(mocks.dbQuery).toHaveBeenCalledWith(
      expect.stringContaining("WHERE id = $1"),
      ["tenant-1"]
    );
  });

  it("requires tenant context instead of defaulting to the default tenant", async () => {
    mocks.getSessionUser.mockResolvedValue({
      id: "user-1",
      tenant_id: "",
      tenant_slug: "default",
      real_tenant_id: "",
      role_name: "tenant_admin"
    });

    await expect(requireTenantContext()).rejects.toThrow("No tenant context available");
  });
});
