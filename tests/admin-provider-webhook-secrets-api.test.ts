import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  listProviderWebhookSecrets: vi.fn(),
  rotateProviderWebhookSecret: vi.fn(),
  revokeProviderWebhookSecret: vi.fn(),
  recordAuditLog: vi.fn()
}));

vi.mock("@/server/auth/session", () => ({
  getSessionUser: mocks.getSessionUser
}));

vi.mock("@/server/audit", () => ({
  recordAuditLog: mocks.recordAuditLog
}));

vi.mock("@/server/provider-webhook-secrets", async () => {
  const actual = await vi.importActual<typeof import("@/server/provider-webhook-secrets")>(
    "@/server/provider-webhook-secrets"
  );
  return {
    ...actual,
    listProviderWebhookSecrets: mocks.listProviderWebhookSecrets,
    rotateProviderWebhookSecret: mocks.rotateProviderWebhookSecret,
    revokeProviderWebhookSecret: mocks.revokeProviderWebhookSecret
  };
});

import { DELETE, GET, POST } from "@/app/api/admin/tenant/provider-webhook-secrets/route";
import { ProviderWebhookSecretConfigurationError } from "@/server/provider-webhook-secrets";

const SECRET_SUMMARY = {
  id: "11111111-1111-1111-1111-111111111111",
  tenantKey: "tenant-a",
  workspaceKey: "workspace-a",
  provider: "whatsapp",
  secretType: "app_secret",
  providerAccountId: "waba-1",
  label: "Meta app secret",
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

describe("/api/admin/tenant/provider-webhook-secrets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.recordAuditLog.mockResolvedValue(undefined);
  });

  it("returns 403 for non-admin users", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser("agent"));

    const response = await GET();

    expect(response.status).toBe(403);
    expect(mocks.listProviderWebhookSecrets).not.toHaveBeenCalled();
  });

  it("lists provider webhook secret metadata without plaintext", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser("lead_admin"));
    mocks.listProviderWebhookSecrets.mockResolvedValue([SECRET_SUMMARY]);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.secrets).toEqual([SECRET_SUMMARY]);
    expect(JSON.stringify(body)).not.toContain("plaintextSecret");
    expect(mocks.listProviderWebhookSecrets).toHaveBeenCalledWith({
      tenantKey: "tenant-a",
      workspaceKey: "workspace-a"
    });
  });

  it("rotates a provider webhook secret and audits the scoped operation", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser("lead_admin"));
    mocks.rotateProviderWebhookSecret.mockResolvedValue({
      secret: SECRET_SUMMARY,
      plaintextSecret: "provided-meta-secret",
      generated: false
    });

    const response = await POST(
      new Request("http://localhost/api/admin/tenant/provider-webhook-secrets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          provider: "whatsapp",
          secretType: "app_secret",
          providerAccountId: "waba-1",
          label: "Meta app secret",
          secret: "provided-meta-secret",
          reason: "Tenant onboarding"
        })
      })
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body).toMatchObject({
      status: "rotated",
      plaintextSecret: "provided-meta-secret",
      plaintextReturnedOnce: true,
      secret: { id: SECRET_SUMMARY.id, fingerprint: SECRET_SUMMARY.fingerprint }
    });
    expect(mocks.rotateProviderWebhookSecret).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: { tenantKey: "tenant-a", workspaceKey: "workspace-a" },
        provider: "whatsapp",
        secretType: "app_secret",
        providerAccountId: "waba-1",
        actorUserId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
      })
    );
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantKey: "tenant-a",
        workspaceKey: "workspace-a",
        action: "provider_webhook_secret_rotated",
        entityId: SECRET_SUMMARY.id
      })
    );
  });

  it("surfaces missing encryption-key configuration as a 503", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser("lead_admin"));
    mocks.rotateProviderWebhookSecret.mockRejectedValue(
      new ProviderWebhookSecretConfigurationError(
        "PROVIDER_WEBHOOK_SECRET_ENCRYPTION_KEY is required."
      )
    );

    const response = await POST(
      new Request("http://localhost/api/admin/tenant/provider-webhook-secrets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: "resend", secretType: "webhook_secret" })
      })
    );
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toMatchObject({
      code: "provider_webhook_secret_configuration_missing"
    });
  });

  it("revokes provider webhook secrets inside the tenant scope", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser("lead_admin"));
    mocks.revokeProviderWebhookSecret.mockResolvedValue({
      ...SECRET_SUMMARY,
      status: "revoked"
    });

    const response = await DELETE(
      new Request(
        `http://localhost/api/admin/tenant/provider-webhook-secrets?id=${SECRET_SUMMARY.id}`,
        { method: "DELETE" }
      )
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      status: "revoked",
      secret: { id: SECRET_SUMMARY.id, status: "revoked" }
    });
    expect(mocks.revokeProviderWebhookSecret).toHaveBeenCalledWith({
      scope: { tenantKey: "tenant-a", workspaceKey: "workspace-a" },
      secretId: SECRET_SUMMARY.id
    });
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "provider_webhook_secret_revoked",
        entityId: SECRET_SUMMARY.id
      })
    );
  });
});
