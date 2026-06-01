import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listActiveTenantIngressSigningSecrets: vi.fn(),
  markTenantIngressSigningSecretUsed: vi.fn()
}));

vi.mock("@/server/tenant-ingress-secrets", () => ({
  listActiveTenantIngressSigningSecrets: mocks.listActiveTenantIngressSigningSecrets,
  markTenantIngressSigningSecretUsed: mocks.markTenantIngressSigningSecretUsed
}));

import {
  buildTenantIngressSignature,
  tenantScopeFromMachineRequestAsync
} from "@/server/tenant-context";

const ORIGINAL_ENV = { ...process.env };
const TENANT_SECRET = "persisted-tenant-secret";

function signedRequest(path: string) {
  const tenantKey = "tenant-a";
  const workspaceKey = "workspace-a";
  const timestamp = new Date().toISOString();
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: {
      "x-6esk-tenant": tenantKey,
      "x-6esk-workspace": workspaceKey,
      "x-6esk-tenant-timestamp": timestamp,
      "x-6esk-tenant-signature": buildTenantIngressSignature({
        tenantKey,
        workspaceKey,
        method: "POST",
        path,
        timestamp,
        secret: TENANT_SECRET
      })
    }
  });
}

describe("tenantScopeFromMachineRequestAsync persisted signing secrets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = {
      ...ORIGINAL_ENV,
      NODE_ENV: "test",
      TENANT_INGRESS_REQUIRE_SCOPE: "true",
      TENANT_INGRESS_REQUIRE_SIGNATURE: "true"
    };
    mocks.markTenantIngressSigningSecretUsed.mockResolvedValue(undefined);
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("accepts persisted active tenant ingress signing secrets", async () => {
    mocks.listActiveTenantIngressSigningSecrets.mockResolvedValue([
      { id: "11111111-1111-1111-1111-111111111111", secret: TENANT_SECRET }
    ]);

    await expect(
      tenantScopeFromMachineRequestAsync(signedRequest("/api/admin/calls/outbox?limit=25"))
    ).resolves.toEqual({
      tenantKey: "tenant-a",
      workspaceKey: "workspace-a"
    });
    expect(mocks.listActiveTenantIngressSigningSecrets).toHaveBeenCalledWith({
      tenantKey: "tenant-a",
      workspaceKey: "workspace-a"
    });
    expect(mocks.markTenantIngressSigningSecretUsed).toHaveBeenCalledWith(
      "11111111-1111-1111-1111-111111111111",
      { tenantKey: "tenant-a", workspaceKey: "workspace-a" }
    );
  });

  it("fails closed when no persisted or env signing secret exists", async () => {
    mocks.listActiveTenantIngressSigningSecrets.mockResolvedValue([]);

    await expect(
      tenantScopeFromMachineRequestAsync(signedRequest("/api/admin/calls/outbox?limit=25"))
    ).rejects.toMatchObject({
      code: "tenant_signature_secret_missing",
      status: 503
    });
  });
});
