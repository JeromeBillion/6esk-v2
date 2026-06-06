import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertSensitiveSessionMfa: vi.fn(),
  getSessionUser: vi.fn(),
  sensitiveSessionErrorResponse: vi.fn(),
  tenantScopeFromMachineRequestAsync: vi.fn(),
  tenantScopeFromUser: vi.fn()
}));

vi.mock("@/server/auth/session", () => ({
  getSessionUser: mocks.getSessionUser
}));

vi.mock("@/server/auth/sensitive-session", () => ({
  assertSensitiveSessionMfa: mocks.assertSensitiveSessionMfa,
  sensitiveSessionErrorResponse: mocks.sensitiveSessionErrorResponse
}));

vi.mock("@/server/tenant-context", () => ({
  isTenantIngressScopeError: (error: unknown) =>
    error instanceof Error && error.name === "TenantIngressScopeError",
  tenantScopeFromMachineRequestAsync: mocks.tenantScopeFromMachineRequestAsync,
  tenantScopeFromUser: mocks.tenantScopeFromUser
}));

import {
  requireBillingAdminAccess,
  requireLeadAdminAccess,
  requireLeadAdminOrMachineAccess
} from "@/server/auth/admin-guard";

const ORIGINAL_ENV = { ...process.env };

function user(roleName: string, authProvider = "password_mfa") {
  return {
    id: `${roleName}-user`,
    email: `${roleName}@example.test`,
    display_name: roleName,
    role_id: null,
    role_name: roleName,
    tenant_key: "tenant-user",
    workspace_key: "workspace-user",
    session_auth_provider: authProvider
  };
}

function request(secret?: string) {
  return new Request("http://localhost/api/admin/inbound/retry", {
    method: "POST",
    headers: secret ? { "x-6esk-secret": secret } : undefined
  });
}

describe("admin access guards", () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV, INBOUND_SHARED_SECRET: "machine-secret" };
    vi.clearAllMocks();
    mocks.assertSensitiveSessionMfa.mockResolvedValue(undefined);
    mocks.sensitiveSessionErrorResponse.mockReturnValue(null);
    mocks.tenantScopeFromUser.mockReturnValue({
      tenantKey: "tenant-user",
      workspaceKey: "workspace-user"
    });
    mocks.tenantScopeFromMachineRequestAsync.mockResolvedValue({
      tenantKey: "tenant-machine",
      workspaceKey: "workspace-machine"
    });
  });

  it("requires a lead admin for admin access", async () => {
    mocks.getSessionUser.mockResolvedValue(user("agent"));

    const access = await requireLeadAdminAccess();

    expect(access.ok).toBe(false);
    if (!access.ok) expect(access.response.status).toBe(403);
    expect(mocks.assertSensitiveSessionMfa).not.toHaveBeenCalled();
  });

  it("checks sensitive-session MFA when requested", async () => {
    const leadAdmin = user("lead_admin", "password");
    mocks.getSessionUser.mockResolvedValue(leadAdmin);

    const access = await requireLeadAdminAccess({ requireMfa: true });

    expect(access.ok).toBe(true);
    expect(mocks.assertSensitiveSessionMfa).toHaveBeenCalledWith({
      user: leadAdmin,
      authProvider: "password"
    });
  });

  it("allows finance admins only through the billing admin guard", async () => {
    const financeAdmin = user("finance_admin", "password");
    mocks.getSessionUser.mockResolvedValue(financeAdmin);

    const leadAccess = await requireLeadAdminAccess({ requireMfa: true });
    const billingAccess = await requireBillingAdminAccess({ requireMfa: true });

    expect(leadAccess.ok).toBe(false);
    expect(billingAccess.ok).toBe(true);
    expect(mocks.assertSensitiveSessionMfa).toHaveBeenCalledWith({
      user: financeAdmin,
      authProvider: "password"
    });
  });

  it("returns the MFA error response when sensitive-session MFA fails", async () => {
    mocks.getSessionUser.mockResolvedValue(user("lead_admin", "password"));
    const error = new Error("MFA required");
    const response = Response.json({ error: "MFA required", code: "mfa_required" }, { status: 403 });
    mocks.assertSensitiveSessionMfa.mockRejectedValue(error);
    mocks.sensitiveSessionErrorResponse.mockReturnValue(response);

    const access = await requireLeadAdminAccess({ requireMfa: true });

    expect(access.ok).toBe(false);
    if (!access.ok) expect(access.response).toBe(response);
  });

  it("does not let a non-admin browser user bypass with a worker secret", async () => {
    mocks.getSessionUser.mockResolvedValue(user("agent"));

    const access = await requireLeadAdminOrMachineAccess(request("machine-secret"), {
      secretEnvNames: ["INBOUND_SHARED_SECRET"]
    });

    expect(access.ok).toBe(false);
    if (!access.ok) expect(access.response.status).toBe(403);
    expect(mocks.tenantScopeFromMachineRequestAsync).not.toHaveBeenCalled();
  });

  it("allows machine access only when the configured secret and tenant envelope pass", async () => {
    mocks.getSessionUser.mockResolvedValue(null);

    const access = await requireLeadAdminOrMachineAccess(request("machine-secret"), {
      secretEnvNames: ["INBOUND_SHARED_SECRET"]
    });

    expect(access).toMatchObject({
      ok: true,
      user: null,
      scope: {
        tenantKey: "tenant-machine",
        workspaceKey: "workspace-machine"
      },
      authMode: "machine"
    });
    expect(mocks.tenantScopeFromMachineRequestAsync).toHaveBeenCalled();
  });

  it("returns unauthorized when machine access is missing the shared secret", async () => {
    mocks.getSessionUser.mockResolvedValue(null);

    const access = await requireLeadAdminOrMachineAccess(request(), {
      secretEnvNames: ["INBOUND_SHARED_SECRET"]
    });

    expect(access.ok).toBe(false);
    if (!access.ok) expect(access.response.status).toBe(401);
    expect(mocks.tenantScopeFromMachineRequestAsync).not.toHaveBeenCalled();
  });

  it("surfaces tenant ingress errors from machine access", async () => {
    mocks.getSessionUser.mockResolvedValue(null);
    const error = Object.assign(new Error("Tenant scope is required."), {
      name: "TenantIngressScopeError",
      code: "tenant_scope_required",
      status: 400
    });
    mocks.tenantScopeFromMachineRequestAsync.mockRejectedValue(error);

    const access = await requireLeadAdminOrMachineAccess(request("machine-secret"), {
      secretEnvNames: ["INBOUND_SHARED_SECRET"]
    });

    expect(access.ok).toBe(false);
    if (!access.ok) {
      expect(access.response.status).toBe(400);
      await expect(access.response.json()).resolves.toMatchObject({
        code: "tenant_scope_required"
      });
    }
  });
});
