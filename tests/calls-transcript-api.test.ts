import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authorizeCallWebhook: vi.fn(),
  attachCallTranscript: vi.fn(),
  resolveCallSessionProviderScope: vi.fn(),
  listActiveProviderWebhookSecrets: vi.fn(),
  markProviderWebhookSecretUsed: vi.fn(),
  recordAuditLog: vi.fn()
}));

vi.mock("@/server/calls/webhook", () => ({
  authorizeCallWebhook: mocks.authorizeCallWebhook
}));

vi.mock("@/server/calls/service", () => ({
  attachCallTranscript: mocks.attachCallTranscript,
  resolveCallSessionProviderScope: mocks.resolveCallSessionProviderScope
}));

vi.mock("@/server/audit", () => ({
  recordAuditLog: mocks.recordAuditLog
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

import { POST } from "@/app/api/calls/transcript/route";

const ORIGINAL_ENV = { ...process.env };
const TENANT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

describe("POST /api/calls/transcript", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = {
      ...ORIGINAL_ENV,
      TENANT_PROVIDER_WEBHOOK_REQUIRE_SECRETS: "false"
    };
    mocks.recordAuditLog.mockResolvedValue(undefined);
    mocks.resolveCallSessionProviderScope.mockResolvedValue({
      tenantId: TENANT_ID,
      workspaceKey: "primary"
    });
    mocks.listActiveProviderWebhookSecrets.mockResolvedValue([]);
    mocks.markProviderWebhookSecretUsed.mockResolvedValue(undefined);
    mocks.authorizeCallWebhook.mockReturnValue({
      authorized: true,
      mode: "hmac",
      reason: "ok"
    });
    mocks.attachCallTranscript.mockResolvedValue({
      status: "attached",
      callSessionId: "11111111-1111-1111-1111-111111111111",
      transcriptR2Key: "messages/msg/transcript.txt",
      attachmentId: "22222222-2222-2222-2222-222222222222"
    });
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("returns 401 when webhook authorization fails", async () => {
    mocks.authorizeCallWebhook.mockReturnValue({
      authorized: false,
      mode: "hmac",
      reason: "invalid_signature"
    });

    const response = await POST(
      new Request("http://localhost/api/calls/transcript", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({})
      })
    );
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toMatchObject({ error: "Unauthorized" });
  });

  it("returns 400 when transcript payload is missing text/url", async () => {
    const response = await POST(
      new Request("http://localhost/api/calls/transcript", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          callSessionId: "11111111-1111-1111-1111-111111111111"
        })
      })
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toMatchObject({
      error: "transcriptText or transcriptUrl is required"
    });
  });

  it("attaches transcript when payload is valid", async () => {
    const response = await POST(
      new Request("http://localhost/api/calls/transcript", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          callSessionId: "11111111-1111-1111-1111-111111111111",
          transcriptText: "Customer asked for payout timeline."
        })
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      status: "attached",
      callSessionId: "11111111-1111-1111-1111-111111111111"
    });
    expect(mocks.attachCallTranscript).toHaveBeenCalledWith(
      expect.objectContaining({
        callSessionId: "11111111-1111-1111-1111-111111111111",
        transcriptText: "Customer asked for payout timeline."
      })
    );
  });

  it("accepts transcript callbacks with the dedicated shared secret without using webhook hmac auth", async () => {
    process.env.CALLS_TRANSCRIPT_SHARED_SECRET = "stt-secret";

    const response = await POST(
      new Request("http://localhost/api/calls/transcript", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-6esk-secret": "stt-secret"
        },
        body: JSON.stringify({
          callSessionId: "11111111-1111-1111-1111-111111111111",
          transcriptText: "Transcript from managed STT callback."
        })
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      status: "attached",
      callSessionId: "11111111-1111-1111-1111-111111111111"
    });
    expect(mocks.authorizeCallWebhook).not.toHaveBeenCalled();
  });

  it("accepts Deepgram callback payloads with the provider token and normalizes them into transcript attachments", async () => {
    process.env.CALLS_STT_DEEPGRAM_CALLBACK_TOKEN = "dg-callback-token";

    const response = await POST(
      new Request("http://localhost/api/calls/transcript", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "dg-token": "dg-callback-token"
        },
        body: JSON.stringify({
          metadata: {
            request_id: "dg-request-1",
            extra: {
              callSessionId: "11111111-1111-1111-1111-111111111111",
              providerCallId: "provider-call-1"
            }
          },
          results: {
            utterances: [
              {
                speaker: 0,
                transcript: "Good afternoon, how can I help?"
              },
              {
                speaker: 1,
                transcript: "I need an update on my payout."
              }
            ]
          }
        })
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      status: "attached",
      callSessionId: "11111111-1111-1111-1111-111111111111"
    });
    expect(mocks.authorizeCallWebhook).not.toHaveBeenCalled();
    expect(mocks.attachCallTranscript).toHaveBeenCalledWith(
      expect.objectContaining({
        callSessionId: "11111111-1111-1111-1111-111111111111",
        provider: "deepgram",
        providerCallId: "provider-call-1",
        transcriptText:
          "Speaker 1: Good afternoon, how can I help?\nSpeaker 2: I need an update on my payout.",
        payload: expect.objectContaining({
          source: "deepgram",
          providerJobId: "dg-request-1"
        })
      })
    );
  });

  it("accepts Deepgram callback payloads when the callback token is passed in the callback URL", async () => {
    process.env.CALLS_STT_DEEPGRAM_CALLBACK_TOKEN = "dg-callback-token";

    const response = await POST(
      new Request("http://localhost/api/calls/transcript?callback_token=dg-callback-token", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          metadata: {
            request_id: "dg-request-2",
            extra: {
              callSessionId: "11111111-1111-1111-1111-111111111111"
            }
          },
          results: {
            utterances: [
              {
                speaker: 0,
                transcript: "Please hold while I check that."
              }
            ]
          }
        })
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      status: "attached",
      callSessionId: "11111111-1111-1111-1111-111111111111"
    });
    expect(mocks.authorizeCallWebhook).not.toHaveBeenCalled();
  });

  it("uses tenant-scoped Deepgram callback tokens in strict mode", async () => {
    process.env.TENANT_PROVIDER_WEBHOOK_REQUIRE_SECRETS = "true";
    process.env.CALLS_STT_DEEPGRAM_CALLBACK_TOKEN = "global-token";
    mocks.listActiveProviderWebhookSecrets.mockResolvedValue([
      { id: "secret-1", secret: "tenant-dg-token", source: "db" }
    ]);

    const response = await POST(
      new Request("http://localhost/api/calls/transcript?callback_token=tenant-dg-token", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          metadata: {
            request_id: "dg-request-3",
            extra: {
              callSessionId: "11111111-1111-1111-1111-111111111111"
            }
          },
          results: {
            utterances: [
              {
                speaker: 0,
                transcript: "The callback token is tenant scoped."
              }
            ]
          }
        })
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.listActiveProviderWebhookSecrets).toHaveBeenCalledWith({
      scope: { tenantId: TENANT_ID, workspaceKey: "primary" },
      provider: "deepgram",
      secretType: "callback_token"
    });
    expect(mocks.markProviderWebhookSecretUsed).toHaveBeenCalledWith("secret-1", {
      tenantId: TENANT_ID,
      workspaceKey: "primary"
    });
    expect(mocks.authorizeCallWebhook).not.toHaveBeenCalled();
  });

  it("fails closed for Deepgram callbacks without a tenant callback token in strict mode", async () => {
    process.env.TENANT_PROVIDER_WEBHOOK_REQUIRE_SECRETS = "true";
    mocks.listActiveProviderWebhookSecrets.mockResolvedValue([]);

    const response = await POST(
      new Request("http://localhost/api/calls/transcript?callback_token=missing-token", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          metadata: {
            request_id: "dg-request-4",
            extra: {
              callSessionId: "11111111-1111-1111-1111-111111111111"
            }
          },
          results: {
            utterances: [
              {
                speaker: 0,
                transcript: "This should not attach."
              }
            ]
          }
        })
      })
    );
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toMatchObject({ code: "provider_webhook_secret_missing" });
    expect(mocks.attachCallTranscript).not.toHaveBeenCalled();
  });
});
