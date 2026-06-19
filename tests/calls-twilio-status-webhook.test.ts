import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  updateCallSessionStatus: vi.fn(),
  resolveCallSessionProviderScope: vi.fn(),
  recordAuditLog: vi.fn(),
  recordPlatformAuditLog: vi.fn(),
  listActiveProviderWebhookSecrets: vi.fn(),
  markProviderWebhookSecretUsed: vi.fn(),
  twilioFactory: vi.fn(),
  twilioValidate: vi.fn()
}));

vi.mock("@/server/calls/service", () => ({
  updateCallSessionStatus: mocks.updateCallSessionStatus,
  resolveCallSessionProviderScope: mocks.resolveCallSessionProviderScope
}));

vi.mock("@/server/audit", () => ({
  recordAuditLog: mocks.recordAuditLog,
  recordPlatformAuditLog: mocks.recordPlatformAuditLog
}));

vi.mock("@/server/provider-webhook-secrets", () => {
  class ProviderWebhookSecretConfigurationError extends Error {}
  return {
    ProviderWebhookSecretConfigurationError,
    listActiveProviderWebhookSecrets: mocks.listActiveProviderWebhookSecrets,
    markProviderWebhookSecretUsed: mocks.markProviderWebhookSecretUsed,
    shouldRequireTenantProviderWebhookSecrets: () =>
      process.env.TENANT_PROVIDER_WEBHOOK_REQUIRE_SECRETS === "true" ||
      process.env.NODE_ENV === "production"
  };
});

vi.mock("twilio", () => {
  const callable = ((...args: unknown[]) => mocks.twilioFactory(...args)) as ((
    ...args: unknown[]
  ) => unknown) & { validateRequest: (...args: unknown[]) => unknown };
  callable.validateRequest = (...args: unknown[]) => mocks.twilioValidate(...args);
  return { default: callable };
});

import { GET } from "@/app/api/calls/webhooks/twilio/status/route";

const ORIGINAL_ENV = { ...process.env };
const TENANT_ID = "33333333-3333-3333-3333-333333333333";

describe("GET /api/calls/webhooks/twilio/status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = {
      ...ORIGINAL_ENV,
      APP_URL: "https://app.6esk.test",
      CALLS_TWILIO_ACCOUNT_SID: "AC123",
      CALLS_TWILIO_AUTH_TOKEN: "auth-token",
      TENANT_PROVIDER_WEBHOOK_REQUIRE_SECRETS: "false"
    };
    mocks.resolveCallSessionProviderScope.mockResolvedValue({
      tenantId: TENANT_ID,
      workspaceKey: "primary"
    });
    mocks.listActiveProviderWebhookSecrets.mockResolvedValue([]);
    mocks.markProviderWebhookSecretUsed.mockResolvedValue(undefined);
    mocks.updateCallSessionStatus.mockResolvedValue({
      status: "updated",
      callSessionId: "call-session-1",
      previousStatus: "dialing",
      currentStatus: "ringing",
      ticketId: "ticket-1",
      mailboxId: "mailbox-1",
      messageId: "message-1"
    });
    mocks.recordAuditLog.mockResolvedValue(undefined);
    mocks.recordPlatformAuditLog.mockResolvedValue(undefined);
    mocks.twilioValidate.mockReturnValue(true);
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("accepts Twilio callbacks directly in 6esk", async () => {
    const response = await GET(
      new Request(
        "https://app.6esk.test/api/calls/webhooks/twilio/status?CallSid=CA123&CallStatus=ringing&CallDuration=12&Timestamp=1710000000",
        {
          headers: {
            "x-twilio-signature": "sig"
          }
        }
      )
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      status: "updated",
      callSessionId: "call-session-1"
    });
    expect(mocks.twilioValidate).toHaveBeenCalledWith(
      "auth-token",
      "sig",
      "https://app.6esk.test/api/calls/webhooks/twilio/status?CallSid=CA123&CallStatus=ringing&CallDuration=12&Timestamp=1710000000",
      {}
    );
    expect(mocks.updateCallSessionStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "twilio",
        providerCallId: "CA123",
        status: "ringing"
      })
    );
  });

  it("uses the tenant-scoped Twilio auth token in strict mode", async () => {
    process.env.TENANT_PROVIDER_WEBHOOK_REQUIRE_SECRETS = "true";
    mocks.listActiveProviderWebhookSecrets.mockResolvedValue([
      { id: "secret-1", secret: "tenant-auth-token", source: "db" }
    ]);
    mocks.twilioValidate.mockImplementation((token) => token === "tenant-auth-token");

    const response = await GET(
      new Request(
        "https://app.6esk.test/api/calls/webhooks/twilio/status?CallSid=CA123&AccountSid=AC123&CallStatus=ringing",
        {
          headers: {
            "x-twilio-signature": "sig"
          }
        }
      )
    );

    expect(response.status).toBe(200);
    expect(mocks.listActiveProviderWebhookSecrets).toHaveBeenCalledWith({
      scope: { tenantId: TENANT_ID, workspaceKey: "primary" },
      provider: "twilio",
      secretType: "auth_token",
      providerAccountId: "AC123"
    });
    expect(mocks.twilioValidate).toHaveBeenCalledWith(
      "tenant-auth-token",
      "sig",
      "https://app.6esk.test/api/calls/webhooks/twilio/status?CallSid=CA123&AccountSid=AC123&CallStatus=ringing",
      {}
    );
    expect(mocks.markProviderWebhookSecretUsed).toHaveBeenCalledWith("secret-1", {
      tenantId: TENANT_ID,
      workspaceKey: "primary"
    });
  });

  it("fails closed in strict mode when the tenant has no Twilio auth token", async () => {
    process.env.TENANT_PROVIDER_WEBHOOK_REQUIRE_SECRETS = "true";
    mocks.listActiveProviderWebhookSecrets.mockResolvedValue([]);

    const response = await GET(
      new Request(
        "https://app.6esk.test/api/calls/webhooks/twilio/status?CallSid=CA123&AccountSid=AC123&CallStatus=ringing",
        {
          headers: {
            "x-twilio-signature": "sig"
          }
        }
      )
    );
    const payload = await response.json();

    expect(response.status).toBe(503);
    expect(payload).toMatchObject({ code: "provider_webhook_secret_missing" });
    expect(mocks.updateCallSessionStatus).not.toHaveBeenCalled();
  });
});
