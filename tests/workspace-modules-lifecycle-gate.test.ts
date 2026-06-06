import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dbQuery: vi.fn()
}));

vi.mock("@/server/db", () => ({
  db: {
    query: mocks.dbQuery
  }
}));

const TENANT_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

describe("workspace module lifecycle gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("allows enabled modules only when tenant is active", async () => {
    const { isWorkspaceModuleEnabled } = await import("@/server/workspace-modules");
    mocks.dbQuery.mockResolvedValueOnce({ rows: [{ status: "active" }] });

    await expect(isWorkspaceModuleEnabled("email", "primary", TENANT_ID)).resolves.toBe(true);
    expect(mocks.dbQuery).toHaveBeenCalledWith(expect.stringContaining("FROM tenants"), [
      TENANT_ID
    ]);
  });

  it("fails closed for suspended tenants before module defaults are applied", async () => {
    const { isWorkspaceModuleEnabled } = await import("@/server/workspace-modules");
    mocks.dbQuery.mockResolvedValueOnce({ rows: [{ status: "suspended" }] });

    await expect(isWorkspaceModuleEnabled("email", "primary", TENANT_ID)).resolves.toBe(false);
  });

  it("fails closed when tenant status cannot be loaded", async () => {
    const { isWorkspaceModuleEnabled } = await import("@/server/workspace-modules");
    mocks.dbQuery.mockRejectedValueOnce(new Error("db unavailable"));

    await expect(isWorkspaceModuleEnabled("email", "primary", TENANT_ID)).resolves.toBe(false);
  });
});
