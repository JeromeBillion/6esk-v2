import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildWhatsAppSignature } from "@/server/whatsapp/signature";

const mocks = vi.hoisted(() => ({
  dbQuery: vi.fn(),
  resolveWhatsAppAccountForInbound: vi.fn(),
  storeInboundWhatsApp: vi.fn(),
  listActiveProviderWebhookSecrets: vi.fn(),
  markProviderWebhookSecretUsed: vi.fn()
}));

vi.mock("@/server/db", () => ({
  db: {
    query: mocks.dbQuery
  }
}));

vi.mock("@/server/whatsapp/inbound-store", () => ({
  resolveWhatsAppAccountForInbound: mocks.resolveWhatsAppAccountForInbound,
  storeInboundWhatsApp: mocks.storeInboundWhatsApp
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

const ORIGINAL_ENV = { ...process.env };
const TENANT_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

describe("POST /api/whatsapp/inbound provider webhook secrets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = {
      ...ORIGINAL_ENV,
      WHATSAPP_APP_SECRET: "global-secret",
      WHATSAPP_ALLOW_UNSIGNED_WEBHOOKS: "false"
    };
    mocks.dbQuery.mockResolvedValue({ rows: [] });
    mocks.resolveWhatsAppAccountForInbound.mockResolvedValue({
      id: "whatsapp-account-1",
      tenant_id: TENANT_ID,
      provider: "meta",
      phone_number: "+27110000000",
      waba_id: "waba-tenant",
      access_token: null
    });
    mocks.storeInboundWhatsApp.mockResolvedValue({
      status: "created",
      messageId: "message-1",
      ticketId: "ticket-1"
    });
    mocks.listActiveProviderWebhookSecrets.mockResolvedValue([
      {
        id: "provider-secret-1",
        secret: "tenant-meta-secret",
        source: "db"
      }
    ]);
    mocks.markProviderWebhookSecretUsed.mockResolvedValue(undefined);
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("accepts a tenant-scoped persisted Meta app secret when the global secret does not match", async () => {
    const { POST } = await import("@/app/api/whatsapp/inbound/route");
    const body = JSON.stringify({
      object: "whatsapp_business_account",
      entry: [
        {
          id: "waba-tenant",
          changes: [
            {
              value: {
                metadata: {
                  display_phone_number: "+27110000000"
                },
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
        headers: {
          "content-type": "application/json",
          "x-hub-signature-256": buildWhatsAppSignature(body, "tenant-meta-secret")
        },
        body
      })
    );
    const responseBody = await response.json();

    expect(response.status).toBe(200);
    expect(responseBody).toMatchObject({ status: "received", processed: 1 });
    expect(mocks.listActiveProviderWebhookSecrets).toHaveBeenCalledWith({
      scope: { tenantId: TENANT_ID },
      provider: "whatsapp",
      secretType: "app_secret",
      providerAccountId: "waba-tenant"
    });
    expect(mocks.markProviderWebhookSecretUsed).toHaveBeenCalledWith("provider-secret-1", {
      tenantId: TENANT_ID
    });
    expect(mocks.dbQuery).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO whatsapp_events"), [
      TENANT_ID,
      "inbound",
      expect.any(Object),
      "received"
    ]);
    expect(mocks.storeInboundWhatsApp).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "meta",
        messageId: "wamid.1",
        from: "27710000001",
        to: "+27110000000"
      })
    );
  });
});
