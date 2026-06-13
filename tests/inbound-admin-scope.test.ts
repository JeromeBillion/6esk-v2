import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  shouldRequireTenantIngressSigningSecrets: vi.fn(),
  resolveTenantIngressRequestScope: vi.fn(),
  isTenantIngressVerificationError: vi.fn()
}));

vi.mock("@/server/tenant-ingress-secrets", () => ({
  shouldRequireTenantIngressSigningSecrets: mocks.shouldRequireTenantIngressSigningSecrets,
  resolveTenantIngressRequestScope: mocks.resolveTenantIngressRequestScope,
  isTenantIngressVerificationError: mocks.isTenantIngressVerificationError
}));

import { resolveInboundAdminScope } from "@/server/email/inbound-admin-scope";

const TENANT_ID = "22222222-2222-4222-8222-222222222222";

function buildUser(tenantId: string | null = TENANT_ID) {
  return {
    id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    email: "admin@example.com",
    display_name: "Admin",
    role_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    role_name: "lead_admin",
    tenant_id: tenantId
  };
}

describe("resolveInboundAdminScope", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.INBOUND_SHARED_SECRET = "inbound-secret";
    mocks.shouldRequireTenantIngressSigningSecrets.mockReturnValue(false);
    mocks.isTenantIngressVerificationError.mockReturnValue(false);
  });

  it("uses the session tenant for lead-admin users", async () => {
    const scope = await resolveInboundAdminScope(new Request("http://localhost"), buildUser());

    expect(scope).toMatchObject({
      ok: true,
      tenantId: TENANT_ID,
      actorUserId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      authMode: "session"
    });
    expect(mocks.resolveTenantIngressRequestScope).not.toHaveBeenCalled();
  });

  it("rejects admin-looking sessions without tenant scope", async () => {
    const scope = await resolveInboundAdminScope(new Request("http://localhost"), buildUser(null));

    expect(scope.ok).toBe(false);
    if (!scope.ok) {
      expect(scope.response.status).toBe(403);
    }
  });

  it("uses tenant ingress verification when production policy requires it", async () => {
    mocks.shouldRequireTenantIngressSigningSecrets.mockReturnValue(true);
    mocks.resolveTenantIngressRequestScope.mockResolvedValue({
      tenantId: TENANT_ID,
      workspaceKey: "primary",
      matchedSecretId: "secret-1",
      authMode: "tenant_ingress_secret"
    });

    const request = new Request("http://localhost", {
      headers: {
        "x-6esk-secret": "tenant-secret",
        "x-6esk-tenant-id": TENANT_ID
      }
    });
    const scope = await resolveInboundAdminScope(request, null);

    expect(scope).toMatchObject({
      ok: true,
      tenantId: TENANT_ID,
      actorUserId: null,
      authMode: "tenant_ingress_secret"
    });
    expect(mocks.resolveTenantIngressRequestScope).toHaveBeenCalledWith(request, {
      fallbackGlobalSecret: "inbound-secret",
      fallbackTenantId: TENANT_ID
    });
  });

  it("returns tenant ingress verification errors as responses", async () => {
    mocks.shouldRequireTenantIngressSigningSecrets.mockReturnValue(true);
    const error = Object.assign(new Error("Tenant ingress tenant header is required"), {
      code: "tenant_ingress_tenant_required",
      status: 400
    });
    mocks.resolveTenantIngressRequestScope.mockRejectedValue(error);
    mocks.isTenantIngressVerificationError.mockReturnValue(true);

    const scope = await resolveInboundAdminScope(
      new Request("http://localhost", { headers: { "x-6esk-secret": "tenant-secret" } }),
      null
    );

    expect(scope.ok).toBe(false);
    if (!scope.ok) {
      expect(scope.response.status).toBe(400);
      await expect(scope.response.json()).resolves.toMatchObject({
        error: "Tenant ingress tenant header is required",
        code: "tenant_ingress_tenant_required"
      });
    }
  });

  it("allows development shared-secret fallback with explicit tenant header", async () => {
    const defaultTenantId = "00000000-0000-0000-0000-000000000001";
    const scope = await resolveInboundAdminScope(
      new Request("http://localhost", {
        headers: {
          "x-6esk-secret": "inbound-secret",
          "x-6esk-tenant-id": defaultTenantId
        }
      }),
      null
    );

    expect(scope).toMatchObject({
      ok: true,
      tenantId: defaultTenantId,
      actorUserId: null,
      authMode: "shared_secret"
    });
  });

  it("rejects malformed development tenant headers", async () => {
    const scope = await resolveInboundAdminScope(
      new Request("http://localhost", {
        headers: {
          "x-6esk-secret": "inbound-secret",
          "x-6esk-tenant-id": "not-a-uuid"
        }
      }),
      null
    );

    expect(scope.ok).toBe(false);
    if (!scope.ok) {
      expect(scope.response.status).toBe(400);
      await expect(scope.response.json()).resolves.toMatchObject({
        error: "Tenant header must be a UUID"
      });
    }
  });
});
