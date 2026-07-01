import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveCallSessionProviderScope: vi.fn(),
  listActiveProviderWebhookSecrets: vi.fn(),
  markProviderWebhookSecretUsed: vi.fn()
}));

vi.mock("@/server/calls/service", () => ({
  resolveCallSessionProviderScope: mocks.resolveCallSessionProviderScope
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

import { POST } from "@/app/api/internal/calls/stt/deepgram/route";

const ORIGINAL_ENV = { ...process.env };
const ORIGINAL_FETCH = global.fetch;
const TENANT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

describe("POST /api/internal/calls/stt/deepgram", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = {
      ...ORIGINAL_ENV,
      CALLS_STT_PROVIDER_HTTP_SECRET: "internal-secret",
      CALLS_STT_DEEPGRAM_API_KEY: "deepgram-api-key",
      CALLS_STT_DEEPGRAM_CALLBACK_TOKEN: "deepgram-callback-token",
      CALLS_STT_DEEPGRAM_MODEL: "nova-3",
      TENANT_PROVIDER_WEBHOOK_REQUIRE_SECRETS: "false"
    };
    mocks.resolveCallSessionProviderScope.mockResolvedValue({
      tenantId: TENANT_ID,
      workspaceKey: "primary"
    });
    mocks.listActiveProviderWebhookSecrets.mockResolvedValue([]);
    mocks.markProviderWebhookSecretUsed.mockResolvedValue(undefined);
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ request_id: "dg-request-1" }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    ) as typeof fetch;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    global.fetch = ORIGINAL_FETCH;
  });

  it("returns 401 when the internal shared secret is missing or invalid", async () => {
    const form = new FormData();
    form.set(
      "job",
      JSON.stringify({
        jobId: "11111111-1111-1111-1111-111111111111",
        callSessionId: "22222222-2222-2222-2222-222222222222",
        callbackUrl: "https://app.6esk.test/api/calls/transcript",
        metadata: {}
      })
    );
    form.set("audio", new File([Buffer.from("audio")], "call.mp3", { type: "audio/mpeg" }));

    const response = await POST(
      new Request("http://localhost/api/internal/calls/stt/deepgram", {
        method: "POST",
        body: form
      })
    );

    expect(response.status).toBe(401);
  });

  it("rejects oversized Deepgram jobs before parsing tenant or provider state", async () => {
    const response = await POST(
      new Request("http://localhost/api/internal/calls/stt/deepgram", {
        method: "POST",
        headers: {
          "content-length": String(50 * 1024 * 1024 + 1),
          "x-6esk-secret": "internal-secret"
        },
        body: "not parsed"
      })
    );
    const body = await response.json();

    expect(response.status).toBe(413);
    expect(body).toMatchObject({ error: "Deepgram transcript job payload is too large." });
    expect(mocks.resolveCallSessionProviderScope).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("rejects oversized Deepgram audio before tenant secret lookup or provider spend", async () => {
    process.env.CALLS_STT_DEEPGRAM_MAX_JOB_BYTES = "4";
    const form = new FormData();
    form.set(
      "job",
      JSON.stringify({
        jobId: "11111111-1111-1111-1111-111111111111",
        callSessionId: "22222222-2222-2222-2222-222222222222",
        callbackUrl: "https://app.6esk.test/api/calls/transcript",
        metadata: {}
      })
    );
    form.set("audio", new File([Buffer.from("audio")], "call.mp3", { type: "audio/mpeg" }));

    const response = await POST(
      new Request("http://localhost/api/internal/calls/stt/deepgram", {
        method: "POST",
        headers: {
          "x-6esk-secret": "internal-secret"
        },
        body: form
      })
    );
    const body = await response.json();

    expect(response.status).toBe(413);
    expect(body).toMatchObject({ error: "Deepgram transcript audio is too large." });
    expect(mocks.resolveCallSessionProviderScope).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("submits audio to Deepgram with callback metadata and returns accepted", async () => {
    const form = new FormData();
    form.set(
      "job",
      JSON.stringify({
        jobId: "11111111-1111-1111-1111-111111111111",
        callSessionId: "22222222-2222-2222-2222-222222222222",
        callbackUrl: "https://app.6esk.test/api/calls/transcript",
        metadata: {
          providerCallId: "provider-call-1",
          ticketId: "ticket-1",
          messageId: "message-1"
        }
      })
    );
    form.set("audio", new File([Buffer.from("audio")], "call.mp3", { type: "audio/mpeg" }));

    const response = await POST(
      new Request("http://localhost/api/internal/calls/stt/deepgram", {
        method: "POST",
        headers: {
          "x-6esk-secret": "internal-secret"
        },
        body: form
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      status: "accepted",
      providerJobId: "dg-request-1"
    });
    expect(global.fetch).toHaveBeenCalledTimes(1);

    const [url, init] = vi.mocked(global.fetch).mock.calls[0] as [URL | string, RequestInit];
    const normalizedUrl = String(url);
    expect(normalizedUrl).toContain("https://api.deepgram.com/v1/listen");
    expect(normalizedUrl).toContain(
      "callback=https%3A%2F%2Fapp.6esk.test%2Fapi%2Fcalls%2Ftranscript%3Fcallback_token%3Ddeepgram-callback-token"
    );
    expect(normalizedUrl).toContain("model=nova-3");
    expect(normalizedUrl).toContain("punctuate=true");
    expect(normalizedUrl).toContain("diarize=true");
    expect(normalizedUrl).toContain("utterances=true");
    expect(normalizedUrl).toContain("extra=jobId%3A11111111-1111-1111-1111-111111111111");
    expect(normalizedUrl).toContain("extra=callSessionId%3A22222222-2222-2222-2222-222222222222");
    expect(normalizedUrl).toContain("extra=providerCallId%3Aprovider-call-1");
    expect(init).toMatchObject({
      method: "POST",
      headers: {
        Authorization: "Token deepgram-api-key",
        "Content-Type": "audio/mpeg"
      }
    });
    expect(Buffer.isBuffer(init.body)).toBe(true);
  });

  it("uses tenant-scoped internal and callback secrets in strict mode", async () => {
    process.env.TENANT_PROVIDER_WEBHOOK_REQUIRE_SECRETS = "true";
    mocks.listActiveProviderWebhookSecrets.mockResolvedValue([
      { id: "secret-1", secret: "tenant-http-secret", source: "db" }
    ]);
    const form = new FormData();
    form.set(
      "job",
      JSON.stringify({
        jobId: "11111111-1111-1111-1111-111111111111",
        callSessionId: "22222222-2222-2222-2222-222222222222",
        callbackUrl: "https://app.6esk.test/api/calls/transcript",
        callbackSecret: "tenant-dg-token",
        metadata: {}
      })
    );
    form.set("audio", new File([Buffer.from("audio")], "call.mp3", { type: "audio/mpeg" }));

    const response = await POST(
      new Request("http://localhost/api/internal/calls/stt/deepgram", {
        method: "POST",
        headers: {
          "x-6esk-secret": "tenant-http-secret"
        },
        body: form
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.listActiveProviderWebhookSecrets).toHaveBeenCalledWith({
      scope: { tenantId: TENANT_ID, workspaceKey: "primary" },
      provider: "managed_stt",
      secretType: "http_secret"
    });
    expect(mocks.markProviderWebhookSecretUsed).toHaveBeenCalledWith("secret-1", {
      tenantId: TENANT_ID,
      workspaceKey: "primary"
    });

    const [url] = vi.mocked(global.fetch).mock.calls[0] as [URL | string, RequestInit];
    expect(String(url)).toContain(
      "callback=https%3A%2F%2Fapp.6esk.test%2Fapi%2Fcalls%2Ftranscript%3Fcallback_token%3Dtenant-dg-token"
    );
  });

  it("fails closed in strict mode when the tenant has no internal STT secret", async () => {
    process.env.TENANT_PROVIDER_WEBHOOK_REQUIRE_SECRETS = "true";
    mocks.listActiveProviderWebhookSecrets.mockResolvedValue([]);
    const form = new FormData();
    form.set(
      "job",
      JSON.stringify({
        jobId: "11111111-1111-1111-1111-111111111111",
        callSessionId: "22222222-2222-2222-2222-222222222222",
        callbackUrl: "https://app.6esk.test/api/calls/transcript",
        callbackSecret: "tenant-dg-token",
        metadata: {}
      })
    );
    form.set("audio", new File([Buffer.from("audio")], "call.mp3", { type: "audio/mpeg" }));

    const response = await POST(
      new Request("http://localhost/api/internal/calls/stt/deepgram", {
        method: "POST",
        headers: {
          "x-6esk-secret": "tenant-http-secret"
        },
        body: form
      })
    );
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toMatchObject({ code: "provider_webhook_secret_missing" });
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
