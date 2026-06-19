import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  attachCallRecording: vi.fn(),
  resolveCallSessionProviderScope: vi.fn(),
  recordAuditLog: vi.fn(),
  recordPlatformAuditLog: vi.fn(),
  listActiveProviderWebhookSecrets: vi.fn(),
  markProviderWebhookSecretUsed: vi.fn(),
  twilioFactory: vi.fn(),
  twilioValidate: vi.fn()
}));

vi.mock("@/server/calls/service", () => ({
  attachCallRecording: mocks.attachCallRecording,
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

import { GET } from "@/app/api/calls/webhooks/twilio/recording/route";

const ORIGINAL_ENV = { ...process.env };
const TENANT_ID = "33333333-3333-3333-3333-333333333333";

describe("GET /api/calls/webhooks/twilio/recording", () => {
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
    mocks.attachCallRecording.mockResolvedValue({
      status: "attached",
      callSessionId: "call-session-1",
      recordingUrl: "/api/attachments/a?disposition=inline",
      recordingR2Key: "messages/message-1/recording.mp3"
    });
    mocks.recordAuditLog.mockResolvedValue(undefined);
    mocks.recordPlatformAuditLog.mockResolvedValue(undefined);
    mocks.twilioValidate.mockReturnValue(true);
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("accepts Twilio recording callbacks directly in 6esk", async () => {
    const response = await GET(
      new Request(
        "https://app.6esk.test/api/calls/webhooks/twilio/recording?CallSid=CA123&RecordingSid=RE123&RecordingUrl=https://api.twilio.com/recordings/RE123&RecordingDuration=44&Timestamp=1710000000",
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
      status: "attached",
      callSessionId: "call-session-1"
    });
    expect(mocks.attachCallRecording).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "twilio",
        providerCallId: "CA123",
        recordingUrl: "https://api.twilio.com/recordings/RE123"
      })
    );
    expect(mocks.twilioValidate).toHaveBeenCalledWith(
      "auth-token",
      "sig",
      "https://app.6esk.test/api/calls/webhooks/twilio/recording?CallSid=CA123&RecordingSid=RE123&RecordingUrl=https://api.twilio.com/recordings/RE123&RecordingDuration=44&Timestamp=1710000000",
      {}
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
        "https://app.6esk.test/api/calls/webhooks/twilio/recording?CallSid=CA123&AccountSid=AC123&RecordingSid=RE123&RecordingUrl=https://api.twilio.com/recordings/RE123",
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
      "https://app.6esk.test/api/calls/webhooks/twilio/recording?CallSid=CA123&AccountSid=AC123&RecordingSid=RE123&RecordingUrl=https://api.twilio.com/recordings/RE123",
      {}
    );
    expect(mocks.markProviderWebhookSecretUsed).toHaveBeenCalledWith("secret-1", {
      tenantId: TENANT_ID,
      workspaceKey: "primary"
    });
  });
});
