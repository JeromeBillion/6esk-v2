import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dbQuery: vi.fn(),
  dbConnect: vi.fn()
}));

vi.mock("@/server/db", () => ({
  db: {
    query: mocks.dbQuery,
    connect: mocks.dbConnect
  }
}));

const ORIGINAL_ENV = { ...process.env };
const TENANT_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const USER_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

function secretRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    tenant_id: TENANT_ID,
    workspace_key: "primary",
    label: "Machine ingress",
    status: "active",
    secret_ciphertext: "ciphertext",
    secret_nonce: "nonce",
    secret_tag: "tag",
    secret_fingerprint: "f".repeat(64),
    created_by_user_id: USER_ID,
    rotated_from_secret_id: null,
    expires_at: null,
    last_used_at: null,
    created_at: "2026-06-06T10:00:00.000Z",
    updated_at: "2026-06-06T10:00:00.000Z",
    ...overrides
  };
}

function mockClient() {
  return {
    query: vi.fn(),
    release: vi.fn()
  };
}

describe("tenant ingress signing secrets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = {
      ...ORIGINAL_ENV,
      TENANT_INGRESS_SECRET_ENCRYPTION_KEY: "a".repeat(64)
    };
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("lists metadata inside the v2 tenant_id scope", async () => {
    const { listTenantIngressSigningSecrets } = await import("@/server/tenant-ingress-secrets");
    mocks.dbQuery.mockResolvedValueOnce({ rows: [secretRow()] });

    const secrets = await listTenantIngressSigningSecrets({ tenantId: TENANT_ID });

    expect(secrets).toEqual([
      expect.objectContaining({
        id: "11111111-1111-1111-1111-111111111111",
        tenantId: TENANT_ID,
        workspaceKey: "primary",
        fingerprint: "f".repeat(16)
      })
    ]);
    expect(mocks.dbQuery).toHaveBeenCalledWith(expect.stringContaining("WHERE tenant_id = $1"), [
      TENANT_ID,
      "primary"
    ]);
  });

  it("rotates and returns plaintext once while retiring active secrets", async () => {
    const { rotateTenantIngressSigningSecret } = await import("@/server/tenant-ingress-secrets");
    const client = mockClient();
    mocks.dbConnect.mockResolvedValueOnce(client);
    client.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: "old-secret" }] })
      .mockResolvedValueOnce({
        rows: [
          secretRow({
            secret_ciphertext: "encrypted",
            secret_nonce: "nonce",
            secret_tag: "tag",
            rotated_from_secret_id: "old-secret"
          })
        ]
      })
      .mockResolvedValueOnce({ rows: [] });

    const result = await rotateTenantIngressSigningSecret({
      scope: { tenantId: TENANT_ID },
      actorUserId: USER_ID,
      label: "Primary ingress"
    });

    expect(result.plaintextSecret).toMatch(/^tigs_/);
    expect(result.secret).toMatchObject({
      tenantId: TENANT_ID,
      workspaceKey: "primary",
      rotatedFromSecretId: "old-secret"
    });
    expect(client.query).toHaveBeenNthCalledWith(1, "BEGIN");
    expect(client.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("UPDATE tenant_ingress_signing_secrets"),
      [TENANT_ID, "primary"]
    );
    expect(client.query.mock.calls[2][1][0]).toBe(TENANT_ID);
    expect(client.query.mock.calls[2][1][1]).toBe("primary");
    expect(client.query.mock.calls[2][1][2]).toBe("Primary ingress");
    expect(client.query).toHaveBeenNthCalledWith(4, "COMMIT");
    expect(client.release).toHaveBeenCalled();
  });

  it("fails closed when persisted secret encryption is not configured", async () => {
    const {
      rotateTenantIngressSigningSecret,
      TenantIngressSecretConfigurationError
    } = await import("@/server/tenant-ingress-secrets");
    process.env.TENANT_INGRESS_SECRET_ENCRYPTION_KEY = "";

    await expect(
      rotateTenantIngressSigningSecret({ scope: { tenantId: TENANT_ID } })
    ).rejects.toBeInstanceOf(TenantIngressSecretConfigurationError);
  });
});
