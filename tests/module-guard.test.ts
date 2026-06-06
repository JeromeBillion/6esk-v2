import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getTenantContext: vi.fn(),
  isWorkspaceModuleEnabled: vi.fn()
}));

vi.mock("@/server/tenant/context", () => ({
  getTenantContext: mocks.getTenantContext
}));

vi.mock("@/server/workspace-modules", () => ({
  isWorkspaceModuleEnabled: mocks.isWorkspaceModuleEnabled
}));

describe("module entitlement guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fails closed when tenant context is unavailable", async () => {
    const { checkModuleEntitlement } = await import("@/server/tenant/module-guard");
    mocks.getTenantContext.mockResolvedValue(null);

    const allowed = await checkModuleEntitlement("email");

    expect(allowed).toBe(false);
    expect(mocks.isWorkspaceModuleEnabled).not.toHaveBeenCalled();
  });

  it("uses explicit tenant id when provided", async () => {
    const { checkModuleEntitlement } = await import("@/server/tenant/module-guard");
    mocks.isWorkspaceModuleEnabled.mockResolvedValue(true);

    const allowed = await checkModuleEntitlement(
      "voice",
      "11111111-1111-1111-1111-111111111111"
    );

    expect(allowed).toBe(true);
    expect(mocks.isWorkspaceModuleEnabled).toHaveBeenCalledWith(
      "voice",
      "primary",
      "11111111-1111-1111-1111-111111111111"
    );
  });

  it("fails closed when workspace module runtime entitlement denies usage", async () => {
    const { checkModuleEntitlement } = await import("@/server/tenant/module-guard");
    mocks.isWorkspaceModuleEnabled.mockResolvedValue(false);

    const allowed = await checkModuleEntitlement(
      "email",
      "11111111-1111-1111-1111-111111111111"
    );

    expect(allowed).toBe(false);
    expect(mocks.isWorkspaceModuleEnabled).toHaveBeenCalledWith(
      "email",
      "primary",
      "11111111-1111-1111-1111-111111111111"
    );
  });
});
