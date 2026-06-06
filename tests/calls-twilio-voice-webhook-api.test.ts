import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createOrUpdateInboundCall: vi.fn(),
  resolveInboundCallProviderScope: vi.fn(),
  reserveNextVoiceDeskOperatorForCall: vi.fn(),
  validateTwilioWebhookForTenant: vi.fn(),
  normalizeTwilioParams: vi.fn(),
  buildDeskOperatorDialTwiML: vi.fn(),
  buildHoldAndRetryTwiML: vi.fn(),
  buildUnavailableTwiML: vi.fn(),
  recordAuditLog: vi.fn()
}));

vi.mock("@/server/calls/service", () => ({
  createOrUpdateInboundCall: mocks.createOrUpdateInboundCall,
  resolveInboundCallProviderScope: mocks.resolveInboundCallProviderScope,
  isInboundCallProviderRoutingError: (error: unknown) =>
    Boolean(
      error &&
        typeof error === "object" &&
        "code" in error &&
        String((error as { code?: unknown }).code).endsWith("_call_provider_route")
    )
}));

vi.mock("@/server/calls/operators", () => ({
  reserveNextVoiceDeskOperatorForCall: mocks.reserveNextVoiceDeskOperatorForCall
}));

vi.mock("@/server/calls/twilio", () => ({
  validateTwilioWebhookForTenant: mocks.validateTwilioWebhookForTenant,
  normalizeTwilioParams: mocks.normalizeTwilioParams,
  buildTwilioPublicUrl: vi.fn(() => "https://desk.example.com/api/calls/webhooks/twilio/recording")
}));

vi.mock("@/server/calls/twilio-queue", () => ({
  buildDeskOperatorDialTwiML: mocks.buildDeskOperatorDialTwiML,
  buildHoldAndRetryTwiML: mocks.buildHoldAndRetryTwiML,
  buildUnavailableTwiML: mocks.buildUnavailableTwiML,
  buildVoiceResponse: (body: string) =>
    new Response(body, {
      status: 200,
      headers: { "content-type": "text/xml; charset=utf-8" }
    })
}));

vi.mock("@/server/audit", () => ({
  recordAuditLog: mocks.recordAuditLog
}));

vi.mock("@/server/provider-webhook-secrets", () => {
  class ProviderWebhookSecretConfigurationError extends Error {}
  return {
    ProviderWebhookSecretConfigurationError,
    shouldRequireTenantProviderWebhookSecrets: () =>
      process.env.TENANT_PROVIDER_WEBHOOK_REQUIRE_SECRETS === "true" ||
      process.env.NODE_ENV === "production"
  };
});

import { POST } from "@/app/api/calls/webhooks/twilio/voice/route";

const ORIGINAL_ENV = { ...process.env };

describe("POST /api/calls/webhooks/twilio/voice", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = {
      ...ORIGINAL_ENV,
      TENANT_PROVIDER_WEBHOOK_REQUIRE_SECRETS: "false"
    };
    mocks.normalizeTwilioParams.mockImplementation((params: URLSearchParams) =>
      Object.fromEntries(params.entries())
    );
    mocks.resolveInboundCallProviderScope.mockResolvedValue({
      tenantKey: "tenant-a",
      workspaceKey: "workspace-a"
    });
    mocks.validateTwilioWebhookForTenant.mockResolvedValue({
      valid: true,
      missingSecret: false,
      matchedSecretId: "secret-1"
    });
    mocks.createOrUpdateInboundCall.mockResolvedValue({
      status: "created",
      callSessionId: "call-session-1",
      ticketId: "ticket-1",
      messageId: "message-1",
      createdTicket: true
    });
    mocks.reserveNextVoiceDeskOperatorForCall.mockResolvedValue({
      userId: "123e4567-e89b-12d3-a456-426614174000",
      identity: "desk_user_123e4567-e89b-12d3-a456-426614174000",
      displayName: "Jerome",
      email: "jerome@6ex.co.za",
      status: "online",
      activeCallSessionId: null,
      ringingCallSessionId: "call-session-1"
    });
    mocks.buildDeskOperatorDialTwiML.mockReturnValue(
      `<?xml version="1.0" encoding="UTF-8"?><Response><Dial><Client><Identity>desk_user_user-1</Identity></Client></Dial></Response>`
    );
    mocks.buildHoldAndRetryTwiML.mockReturnValue("<Response><Pause length=\"5\" /></Response>");
    mocks.buildUnavailableTwiML.mockReturnValue("<Response><Hangup /></Response>");
    mocks.recordAuditLog.mockResolvedValue(undefined);
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("creates an inbound call session and returns TwiML that rings desk clients", async () => {
    const body = new URLSearchParams({
      CallSid: "CA-inbound-1",
      From: "+27810000000",
      To: "+16624398187",
      Direction: "inbound"
    });

    const response = await POST(
      new Request("https://desk.example.com/api/calls/webhooks/twilio/voice", {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "x-twilio-signature": "valid"
        },
        body
      })
    );

    const text = await response.text();

    expect(response.status).toBe(200);
    expect(text).toContain("<Identity>desk_user_user-1</Identity>");
    expect(mocks.createOrUpdateInboundCall).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "twilio",
        providerCallId: "CA-inbound-1",
        fromPhone: "+27810000000",
        toPhone: "+16624398187",
        status: "ringing"
      })
    );
    expect(mocks.reserveNextVoiceDeskOperatorForCall).toHaveBeenCalledWith({
      tenantKey: "tenant-a",
      workspaceKey: "workspace-a",
      callSessionId: "call-session-1"
    });
    expect(mocks.buildDeskOperatorDialTwiML).toHaveBeenCalledWith(
      expect.objectContaining({
        callSessionId: "call-session-1",
        offeredUserIds: ["123e4567-e89b-12d3-a456-426614174000"],
        target: expect.objectContaining({
          type: "client",
          identity: "desk_user_123e4567-e89b-12d3-a456-426614174000"
        })
      })
    );
  });

  it("rejects unresolved tenant routes before ringing desk clients", async () => {
    mocks.resolveInboundCallProviderScope.mockRejectedValueOnce(
      Object.assign(new Error("No tenant route matched inbound call."), {
        code: "unresolved_call_provider_route",
        status: 404
      })
    );
    const body = new URLSearchParams({
      CallSid: "CA-inbound-unknown",
      From: "+27810000000",
      To: "+16620000000",
      AccountSid: "AC-unknown",
      Direction: "inbound"
    });

    const response = await POST(
      new Request("https://desk.example.com/api/calls/webhooks/twilio/voice", {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "x-twilio-signature": "valid"
        },
        body
      })
    );
    const payload = await response.json();

    expect(response.status).toBe(404);
    expect(payload).toMatchObject({
      error: "Unresolved call provider route",
      code: "unresolved_call_provider_route"
    });
    expect(mocks.createOrUpdateInboundCall).not.toHaveBeenCalled();
    expect(mocks.reserveNextVoiceDeskOperatorForCall).not.toHaveBeenCalled();
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "call_webhook_rejected",
        data: expect.objectContaining({
          reason: "unresolved_call_provider_route",
          callSid: "CA-inbound-unknown"
        })
      })
    );
  });

  it("fails closed in strict mode when the tenant has no Twilio auth token", async () => {
    process.env.TENANT_PROVIDER_WEBHOOK_REQUIRE_SECRETS = "true";
    mocks.validateTwilioWebhookForTenant.mockResolvedValueOnce({
      valid: false,
      missingSecret: true,
      matchedSecretId: null
    });
    const body = new URLSearchParams({
      CallSid: "CA-inbound-1",
      From: "+27810000000",
      To: "+16624398187",
      AccountSid: "AC123",
      Direction: "inbound"
    });

    const response = await POST(
      new Request("https://desk.example.com/api/calls/webhooks/twilio/voice", {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "x-twilio-signature": "valid"
        },
        body
      })
    );
    const payload = await response.json();

    expect(response.status).toBe(503);
    expect(payload).toMatchObject({ code: "provider_webhook_secret_missing" });
    expect(mocks.createOrUpdateInboundCall).not.toHaveBeenCalled();
  });
});
