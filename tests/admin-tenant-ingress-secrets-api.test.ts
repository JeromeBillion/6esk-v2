import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  listTenantIngressSigningSecrets: vi.fn(),
  rotateTenantIngressSigningSecret: vi.fn(),
  revokeTenantIngressSigningSecret: vi.fn(),
  recordAuditLog: vi.fn()
}));

vi.mock("@/server/auth/session", () => ({
  getSessionUser: mocks.getSessionUser
}));

vi.mock("@/server/audit", () => ({
  recordAuditLog: mocks.recordAuditLog
}));

vi.mock("@/server/tenant-ingress-secrets", async () => {
  const actual = await vi.importActual<typeof import("@/server/tenant-ingress-secrets")>(
    "@/server/tenant-ingress-secrets"
  );
  return {
    ...actual,
    listTenantIngressSigningSecrets: mocks.listTenantIngressSigningSecrets,
    rotateTenantIngressSigningSecret: mocks.rotateTenantIngressSigningSecret,
    revokeTenantIngressSigningSecret: mocks.revokeTenantIngressSigningSecret
  };
});

import { DELETE, GET, POST } from "@/app/api/admin/tenant/ingress-secrets/route";
import { TenantIngressSecretConfigurationError } from "@/server/tenant-ingress-secrets";

const SECRET_SUMMARY = {
  id: "11111111-1111-1111-1111-111111111111",
  tenantKey: "tenant-a",
  workspaceKey: "workspace-a",
  label: "Primary worker",
  status: "active",
  fingerprint: "abcd1234abcd1234",
  createdByUserId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  rotatedFromSecretId: null,
  expiresAt: null,
  lastUsedAt: null,
  createdAt: "2026-05-31T10:00:00.000Z",
  updatedAt: "2026-05-31T10:00:00.000Z"
};

function buildUser(roleName: "lead_admin" | "agent") {
  return {
    id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    email: `${roleName}@example.test`,
    display_name: roleName,
    role_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    role_name: roleName,
    tenant_key: "tenant-a",
    workspace_key: "workspace-a"
  };
}

describe("/api/admin/tenant/ingress-secrets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.recordAuditLog.mockResolvedValue(undefined);
  });

  it("returns 403 for non-admin users", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser("agent"));

    const response = await GET();

    expect(response.status).toBe(403);
    expect(mocks.listTenantIngressSigningSecrets).not.toHaveBeenCalled();
  });

  it("lists tenant ingress signing secret metadata only", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser("lead_admin"));
    mocks.listTenantIngressSigningSecrets.mockResolvedValue([SECRET_SUMMARY]);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.secrets).toEqual([SECRET_SUMMARY]);
    expect(JSON.stringify(body)).not.toContain("plaintextSecret");
    expect(mocks.listTenantIngressSigningSecrets).toHaveBeenCalledWith({
      tenantKey: "tenant-a",
      workspaceKey: "workspace-a"
    });
  });

  it("rotates a secret and returns plaintext once", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser("lead_admin"));
    mocks.rotateTenantIngressSigningSecret.mockResolvedValue({
      secret: SECRET_SUMMARY,
      plaintextSecret: "tigs_new-secret"
    });

    const response = await POST(
      new Request("http://localhost/api/admin/tenant/ingress-secrets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          label: "Primary worker",
          retireExisting: true,
          reason: "Quarterly rotation"
        })
      })
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body).toMatchObject({
      status: "rotated",
      plaintextSecret: "tigs_new-secret",
      plaintextReturnedOnce: true,
      secret: { id: SECRET_SUMMARY.id, fingerprint: SECRET_SUMMARY.fingerprint }
    });
    expect(mocks.rotateTenantIngressSigningSecret).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: { tenantKey: "tenant-a", workspaceKey: "workspace-a" },
        label: "Primary worker",
        actorUserId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        retireExisting: true
      })
    );
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantKey: "tenant-a",
        workspaceKey: "workspace-a",
        action: "tenant_ingress_signing_secret_rotated",
        entityId: SECRET_SUMMARY.id
      })
    );
  });

  it("surfaces missing encryption-key configuration as a launch-blocking 503", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser("lead_admin"));
    mocks.rotateTenantIngressSigningSecret.mockRejectedValue(
      new TenantIngressSecretConfigurationError("TENANT_INGRESS_SECRET_ENCRYPTION_KEY is required.")
    );

    const response = await POST(
      new Request("http://localhost/api/admin/tenant/ingress-secrets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ label: "Primary worker" })
      })
    );
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toMatchObject({
      code: "tenant_ingress_secret_configuration_missing"
    });
  });

  it("revokes tenant-scoped ingress signing secrets", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser("lead_admin"));
    mocks.revokeTenantIngressSigningSecret.mockResolvedValue({
      ...SECRET_SUMMARY,
      status: "revoked"
    });

    const response = await DELETE(
      new Request(
        `http://localhost/api/admin/tenant/ingress-secrets?id=${SECRET_SUMMARY.id}`,
        { method: "DELETE" }
      )
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      status: "revoked",
      secret: { id: SECRET_SUMMARY.id, status: "revoked" }
    });
    expect(mocks.revokeTenantIngressSigningSecret).toHaveBeenCalledWith({
      scope: { tenantKey: "tenant-a", workspaceKey: "workspace-a" },
      secretId: SECRET_SUMMARY.id
    });
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "tenant_ingress_signing_secret_revoked",
        entityId: SECRET_SUMMARY.id
      })
    );
  });
});
