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
    provider: "whatsapp",
    secret_type: "app_secret",
    provider_account_id: "waba-1",
    label: "Meta app secret",
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

describe("provider webhook secret lookup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.dbQuery.mockResolvedValue({ rows: [] });
    process.env = {
      ...ORIGINAL_ENV,
      PROVIDER_WEBHOOK_SECRET_ENCRYPTION_KEY: "b".repeat(64),
      TENANT_PROVIDER_WEBHOOK_SECRETS_JSON: JSON.stringify({
        [`${TENANT_ID}:primary:whatsapp:app_secret`]: "generic-secret",
        [`${TENANT_ID}:primary:whatsapp:app_secret:waba-1`]: "account-secret",
        [`${TENANT_ID}:primary:whatsapp:app_secret:waba-2`]: "other-account-secret"
      })
    };
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("does not use account-specific env secrets when no account id is available", async () => {
    const { listActiveProviderWebhookSecrets } = await import("@/server/provider-webhook-secrets");

    const secrets = await listActiveProviderWebhookSecrets({
      scope: { tenantId: TENANT_ID },
      provider: "whatsapp",
      secretType: "app_secret"
    });

    expect(secrets).toEqual([{ id: "env:0", secret: "generic-secret", source: "env" }]);
  });

  it("uses exact account-specific env secrets plus generic fallback when account id is available", async () => {
    const { listActiveProviderWebhookSecrets } = await import("@/server/provider-webhook-secrets");

    const secrets = await listActiveProviderWebhookSecrets({
      scope: { tenantId: TENANT_ID },
      provider: "whatsapp",
      secretType: "app_secret",
      providerAccountId: "waba-1"
    });

    expect(secrets).toEqual([
      { id: "env:0", secret: "generic-secret", source: "env" },
      { id: "env:1", secret: "account-secret", source: "env" }
    ]);
  });

  it("lists metadata inside the v2 tenant_id scope", async () => {
    const { listProviderWebhookSecrets } = await import("@/server/provider-webhook-secrets");
    mocks.dbQuery.mockResolvedValueOnce({ rows: [secretRow()] });

    const secrets = await listProviderWebhookSecrets({ tenantId: TENANT_ID });

    expect(secrets).toEqual([
      expect.objectContaining({
        id: "11111111-1111-1111-1111-111111111111",
        tenantId: TENANT_ID,
        workspaceKey: "primary",
        provider: "whatsapp",
        secretType: "app_secret",
        fingerprint: "f".repeat(16)
      })
    ]);
    expect(mocks.dbQuery).toHaveBeenCalledWith(expect.stringContaining("WHERE tenant_id = $1"), [
      TENANT_ID,
      "primary"
    ]);
  });

  it("rotates provider webhook secrets with normalized provider metadata", async () => {
    const { rotateProviderWebhookSecret } = await import("@/server/provider-webhook-secrets");
    const client = mockClient();
    mocks.dbConnect.mockResolvedValueOnce(client);
    client.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: "old-secret" }] })
      .mockResolvedValueOnce({
        rows: [
          secretRow({
            rotated_from_secret_id: "old-secret",
            secret_ciphertext: "encrypted",
            secret_nonce: "nonce",
            secret_tag: "tag"
          })
        ]
      })
      .mockResolvedValueOnce({ rows: [] });

    const result = await rotateProviderWebhookSecret({
      scope: { tenantId: TENANT_ID },
      provider: "WhatsApp",
      secretType: "App Secret",
      providerAccountId: "waba-1",
      secret: "provided-secret",
      actorUserId: USER_ID
    });

    expect(result).toMatchObject({
      plaintextSecret: "provided-secret",
      generated: false,
      secret: {
        tenantId: TENANT_ID,
        workspaceKey: "primary",
        provider: "whatsapp",
        secretType: "app_secret"
      }
    });
    expect(client.query.mock.calls[1][1]).toEqual([
      TENANT_ID,
      "primary",
      "whatsapp",
      "app_secret",
      "waba-1"
    ]);
    expect(client.query.mock.calls[2][1][0]).toBe(TENANT_ID);
    expect(client.query.mock.calls[2][1][2]).toBe("whatsapp");
    expect(client.query).toHaveBeenNthCalledWith(4, "COMMIT");
  });
});
