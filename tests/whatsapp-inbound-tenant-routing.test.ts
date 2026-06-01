import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dbQuery: vi.fn(),
  storeInboundWhatsApp: vi.fn(),
  verifyWhatsAppSignature: vi.fn(),
  listActiveProviderWebhookSecrets: vi.fn(),
  markProviderWebhookSecretUsed: vi.fn()
}));

vi.mock("@/server/db", () => ({
  db: {
    query: mocks.dbQuery
  }
}));

vi.mock("@/server/whatsapp/inbound-store", () => ({
  storeInboundWhatsApp: mocks.storeInboundWhatsApp
}));

vi.mock("@/server/whatsapp/signature", () => ({
  verifyWhatsAppSignature: mocks.verifyWhatsAppSignature
}));

vi.mock("@/server/provider-webhook-secrets", async () => {
  const actual = await vi.importActual<typeof import("@/server/provider-webhook-secrets")>(
    "@/server/provider-webhook-secrets"
  );
  return {
    ...actual,
    listActiveProviderWebhookSecrets: mocks.listActiveProviderWebhookSecrets,
    markProviderWebhookSecretUsed: mocks.markProviderWebhookSecretUsed
  };
});

import { POST } from "@/app/api/whatsapp/inbound/route";

const originalTenantIngressRequireScope = process.env.TENANT_INGRESS_REQUIRE_SCOPE;
const originalProviderWebhookRequireSecrets = process.env.TENANT_PROVIDER_WEBHOOK_REQUIRE_SECRETS;

describe("POST /api/whatsapp/inbound tenant routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verifyWhatsAppSignature.mockReturnValue(true);
    mocks.listActiveProviderWebhookSecrets.mockResolvedValue([]);
    mocks.markProviderWebhookSecretUsed.mockResolvedValue(undefined);
    mocks.storeInboundWhatsApp.mockResolvedValue({
      status: "created",
      messageId: "message-1",
      ticketId: "ticket-1"
    });
  });

  afterEach(() => {
    if (originalTenantIngressRequireScope === undefined) {
      delete process.env.TENANT_INGRESS_REQUIRE_SCOPE;
    } else {
      process.env.TENANT_INGRESS_REQUIRE_SCOPE = originalTenantIngressRequireScope;
    }
    if (originalProviderWebhookRequireSecrets === undefined) {
      delete process.env.TENANT_PROVIDER_WEBHOOK_REQUIRE_SECRETS;
    } else {
      process.env.TENANT_PROVIDER_WEBHOOK_REQUIRE_SECRETS = originalProviderWebhookRequireSecrets;
    }
  });

  it("routes Meta webhooks by WABA id before storing messages", async () => {
    mocks.dbQuery
      .mockResolvedValueOnce({
        rows: [{ tenant_key: "tenant-a", workspace_key: "workspace-a" }]
      })
      .mockResolvedValueOnce({ rows: [] });

    const body = JSON.stringify({
      object: "whatsapp_business_account",
      entry: [
        {
          id: "waba-tenant-a",
          changes: [
            {
              value: {
                metadata: {
                  display_phone_number: "+27 11 000 0000"
                },
                contacts: [
                  {
                    wa_id: "27710000001",
                    profile: { name: "Client One" }
                  }
                ],
                messages: [
                  {
                    id: "wamid.1",
                    from: "27710000001",
                    timestamp: "1710000000",
                    type: "text",
                    text: { body: "Hello" }
                  }
                ]
              }
            }
          ]
        }
      ]
    });

    const response = await POST(
      new Request("http://localhost/api/whatsapp/inbound", {
        method: "POST",
        headers: { "x-hub-signature-256": "sha256=sig" },
        body
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.dbQuery).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("INSERT INTO whatsapp_events"),
      ["tenant-a", "workspace-a", "inbound", expect.any(Object), "received"]
    );
    expect(mocks.storeInboundWhatsApp).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "meta",
        messageId: "wamid.1",
        from: "27710000001",
        to: "+27110000000"
      }),
      { tenantKey: "tenant-a", workspaceKey: "workspace-a" }
    );
  });

  it("rejects ambiguous account routing before writing webhook state", async () => {
    mocks.dbQuery.mockResolvedValueOnce({
      rows: [
        { tenant_key: "tenant-a", workspace_key: "workspace-a" },
        { tenant_key: "tenant-b", workspace_key: "workspace-b" }
      ]
    });

    const body = JSON.stringify({
      object: "whatsapp_business_account",
      entry: [
        {
          id: "shared-waba",
          changes: [{ value: { messages: [] } }]
        }
      ]
    });

    const response = await POST(
      new Request("http://localhost/api/whatsapp/inbound", {
        method: "POST",
        headers: { "x-hub-signature-256": "sha256=sig" },
        body
      })
    );

    expect(response.status).toBe(409);
    expect(mocks.dbQuery).toHaveBeenCalledTimes(1);
    expect(mocks.storeInboundWhatsApp).not.toHaveBeenCalled();
  });

  it("rejects unresolved account routing in strict mode before writing webhook state", async () => {
    process.env.TENANT_INGRESS_REQUIRE_SCOPE = "true";
    mocks.dbQuery.mockResolvedValueOnce({ rows: [] });

    const body = JSON.stringify({
      object: "whatsapp_business_account",
      entry: [
        {
          id: "missing-waba",
          changes: [{ value: { messages: [] } }]
        }
      ]
    });

    const response = await POST(
      new Request("http://localhost/api/whatsapp/inbound", {
        method: "POST",
        headers: { "x-hub-signature-256": "sha256=sig" },
        body
      })
    );
    const responseBody = await response.json();

    expect(response.status).toBe(404);
    expect(responseBody).toMatchObject({
      error: "Unresolved WhatsApp tenant route",
      code: "unresolved_whatsapp_tenant_route"
    });
    expect(mocks.dbQuery).toHaveBeenCalledTimes(1);
    expect(mocks.storeInboundWhatsApp).not.toHaveBeenCalled();
  });

  it("requires tenant-scoped provider webhook secrets in strict mode", async () => {
    process.env.TENANT_PROVIDER_WEBHOOK_REQUIRE_SECRETS = "true";
    mocks.dbQuery.mockResolvedValueOnce({
      rows: [{ tenant_key: "tenant-a", workspace_key: "workspace-a" }]
    });
    mocks.listActiveProviderWebhookSecrets.mockResolvedValueOnce([]);

    const response = await POST(
      new Request("http://localhost/api/whatsapp/inbound", {
        method: "POST",
        headers: { "x-hub-signature-256": "sha256=sig" },
        body: JSON.stringify({
          object: "whatsapp_business_account",
          entry: [{ id: "waba-tenant-a", changes: [{ value: { messages: [] } }] }]
        })
      })
    );
    const responseBody = await response.json();

    expect(response.status).toBe(503);
    expect(responseBody).toMatchObject({
      code: "provider_webhook_secret_missing"
    });
    expect(mocks.dbQuery).toHaveBeenCalledTimes(1);
  });

  it("verifies Meta signatures with the matched tenant provider secret", async () => {
    process.env.TENANT_PROVIDER_WEBHOOK_REQUIRE_SECRETS = "true";
    mocks.dbQuery
      .mockResolvedValueOnce({
        rows: [{ tenant_key: "tenant-a", workspace_key: "workspace-a" }]
      })
      .mockResolvedValueOnce({ rows: [] });
    mocks.listActiveProviderWebhookSecrets.mockResolvedValueOnce([
      { id: "secret-1", secret: "tenant-meta-app-secret", source: "db" }
    ]);
    mocks.verifyWhatsAppSignature.mockImplementation(({ appSecret }) => {
      return appSecret === "tenant-meta-app-secret";
    });

    const response = await POST(
      new Request("http://localhost/api/whatsapp/inbound", {
        method: "POST",
        headers: { "x-hub-signature-256": "sha256=sig" },
        body: JSON.stringify({
          object: "whatsapp_business_account",
          entry: [{ id: "waba-tenant-a", changes: [{ value: { messages: [] } }] }]
        })
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.listActiveProviderWebhookSecrets).toHaveBeenCalledWith({
      scope: { tenantKey: "tenant-a", workspaceKey: "workspace-a" },
      provider: "whatsapp",
      secretType: "app_secret"
    });
    expect(mocks.markProviderWebhookSecretUsed).toHaveBeenCalledWith("secret-1", {
      tenantKey: "tenant-a",
      workspaceKey: "workspace-a"
    });
  });
});
