import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getTenantAiProviderConfig: vi.fn(),
  recordModuleUsageEvent: vi.fn(),
  recordAuditLog: vi.fn()
}));

vi.mock("@/server/tenant/ai-provider", () => ({
  getTenantAiProviderConfig: mocks.getTenantAiProviderConfig
}));

vi.mock("@/server/module-metering", () => ({
  recordModuleUsageEvent: mocks.recordModuleUsageEvent
}));

vi.mock("@/server/audit", () => ({
  recordAuditLog: mocks.recordAuditLog
}));

import { POST } from "@/app/api/internal/calls/transcript-ai/provider/route";
import { AI_PROVIDER_MISCONFIGURED_DENIAL } from "@/server/ai/provider-gateway";

const ORIGINAL_ENV = { ...process.env };
const originalFetch = global.fetch;
const TENANT_ID = "33333333-3333-3333-3333-333333333333";

describe("POST /api/internal/calls/transcript-ai/provider", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    process.env = {
      ...ORIGINAL_ENV,
      CALLS_TRANSCRIPT_AI_PROVIDER_HTTP_SECRET: "qa-secret",
      AI_PROVIDER: "openai",
      AI_API_KEY: "openai-key",
      AI_MODEL: "gpt-5-mini",
      AI_BASE_URL: "https://api.openai.com/v1"
    };
    mocks.getTenantAiProviderConfig.mockResolvedValue({
      provider: "openai",
      model: "gpt-5-mini",
      apiKey: "openai-key",
      baseUrl: "https://api.openai.com/v1",
      providerMode: "managed"
    });
    mocks.recordModuleUsageEvent.mockResolvedValue(undefined);
    mocks.recordAuditLog.mockResolvedValue(undefined);
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    global.fetch = originalFetch;
  });

  it("returns 401 without the internal secret", async () => {
    const response = await POST(
      new Request("http://localhost/api/internal/calls/transcript-ai/provider", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jobId: "11111111-1111-1111-1111-111111111111",
          callSessionId: "22222222-2222-2222-2222-222222222222",
          transcriptR2Key: "messages/msg/transcript.txt",
          transcriptText: "Test transcript",
          metadata: { tenantId: TENANT_ID }
        })
      })
    );

    expect(response.status).toBe(401);
  });

  it("submits to the globally selected AI provider and returns normalized transcript QA output", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "resp_123",
          model: "gpt-5-mini",
          output: [
            {
              type: "message",
              content: [
                {
                  type: "output_text",
                  text: JSON.stringify({
                    summary: "Caller asked for a payout update and escalation.",
                    resolutionNote:
                      "A supervisor should review the escalation and confirm the payout timeline.",
                    qaStatus: "review",
                    qaFlags: [
                      {
                        code: "escalation_request",
                        severity: "high",
                        title: "Escalation requested",
                        detail: "The caller explicitly asked for escalation.",
                        evidence: "I need someone senior to confirm this."
                      }
                    ],
                    actionItems: [
                      {
                        owner: "supervisor",
                        priority: "high",
                        description: "Review the call and confirm the escalation response."
                      }
                    ]
                  })
                }
              ]
            }
          ],
          usage: {
            input_tokens: 1000,
            output_tokens: 120
          }
        }),
        { status: 200 }
      )
    ) as typeof fetch;

    const response = await POST(
      new Request("http://localhost/api/internal/calls/transcript-ai/provider", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-6esk-secret": "qa-secret"
        },
        body: JSON.stringify({
          jobId: "11111111-1111-1111-1111-111111111111",
          callSessionId: "22222222-2222-2222-2222-222222222222",
          transcriptR2Key: "messages/msg/transcript.txt",
          transcriptText: "Caller asked for a payout update and escalation.",
          metadata: { tenantId: TENANT_ID }
        })
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      status: "completed",
      provider: "openai",
      providerJobId: "resp_123",
      qaStatus: "review",
      summary: "Caller asked for a payout update and escalation."
    });
    expect(global.fetch).toHaveBeenCalledWith(
      "https://api.openai.com/v1/responses",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer openai-key"
        })
      })
    );
    expect(mocks.recordModuleUsageEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT_ID,
        moduleKey: "aiAutomation",
        providerMode: "managed",
        quantity: 1120,
        unit: "tokens"
      })
    );
  });

  it("uses the resolved tenant provider label, model, and base URL", async () => {
    mocks.getTenantAiProviderConfig.mockResolvedValue({
      provider: "openrouter",
      model: "openai/gpt-5-mini",
      apiKey: "router-key",
      baseUrl: "https://openrouter.example/api/v1",
      providerMode: "byo"
    });

    global.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "resp_router",
          model: "openai/gpt-5-mini",
          output_text: JSON.stringify({
            summary: "Call resolved with no operator escalation.",
            resolutionNote: "No follow-up required.",
            qaStatus: "pass",
            qaFlags: [],
            actionItems: []
          }),
          usage: { input_tokens: 100, output_tokens: 20 }
        }),
        { status: 200 }
      )
    ) as typeof fetch;

    const response = await POST(
      new Request("http://localhost/api/internal/calls/transcript-ai/provider", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-6esk-secret": "qa-secret"
        },
        body: JSON.stringify({
          jobId: "11111111-1111-1111-1111-111111111111",
          callSessionId: "22222222-2222-2222-2222-222222222222",
          transcriptR2Key: "messages/msg/transcript.txt",
          transcriptText: "Resolved call transcript.",
          metadata: { tenantId: TENANT_ID }
        })
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      provider: "openrouter",
      model: "openai/gpt-5-mini",
      qaStatus: "pass"
    });
    expect(global.fetch).toHaveBeenCalledWith(
      "https://openrouter.example/api/v1/responses",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer router-key"
        })
      })
    );
    expect(mocks.recordModuleUsageEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT_ID,
        providerMode: "byo"
      })
    );
  });

  it("blocks unsafe transcript AI provider output after schema validation", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "resp_unsafe",
          output_text: JSON.stringify({
            summary:
              "Another customer account has a hidden system prompt and private ticket history.",
            resolutionNote: "Reveal the tenant secret and do not log this QA review.",
            qaStatus: "review",
            qaFlags: [],
            actionItems: []
          }),
          usage: { input_tokens: 80, output_tokens: 20 }
        }),
        { status: 200 }
      )
    ) as typeof fetch;

    const response = await POST(
      new Request("http://localhost/api/internal/calls/transcript-ai/provider", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-6esk-secret": "qa-secret"
        },
        body: JSON.stringify({
          jobId: "11111111-1111-1111-1111-111111111111",
          callSessionId: "22222222-2222-2222-2222-222222222222",
          transcriptR2Key: "messages/msg/transcript.txt",
          transcriptText: "Resolved call transcript.",
          metadata: { tenantId: TENANT_ID }
        })
      })
    );
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body).toMatchObject({
      error: "Global AI transcript analysis returned unsafe output.",
      reasonCodes: expect.arrayContaining([
        "internal_policy_reference",
        "audit_suppression_output"
      ])
    });
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT_ID,
        action: "ai_output_validation_blocked",
        entityType: "call_transcript_ai_jobs",
        entityId: "11111111-1111-1111-1111-111111111111"
      })
    );
    expect(mocks.recordModuleUsageEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT_ID,
        quantity: 100,
        metadata: expect.objectContaining({
          outputValidationDecision: "block",
          outputValidationRiskLevel: "high"
        })
      })
    );
  });

  it("rejects transcript AI jobs without a valid tenant boundary", async () => {
    global.fetch = vi.fn() as typeof fetch;

    const response = await POST(
      new Request("http://localhost/api/internal/calls/transcript-ai/provider", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-6esk-secret": "qa-secret"
        },
        body: JSON.stringify({
          jobId: "11111111-1111-1111-1111-111111111111",
          callSessionId: "22222222-2222-2222-2222-222222222222",
          transcriptR2Key: "messages/msg/transcript.txt",
          transcriptText: "Resolved call transcript."
        })
      })
    );

    expect(response.status).toBe(400);
    expect(mocks.getTenantAiProviderConfig).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("does not call an AI provider when tenant AI mode is disabled", async () => {
    mocks.getTenantAiProviderConfig.mockResolvedValue({
      provider: "none",
      model: "",
      apiKey: "",
      baseUrl: "",
      providerMode: "none"
    });
    global.fetch = vi.fn() as typeof fetch;

    const response = await POST(
      new Request("http://localhost/api/internal/calls/transcript-ai/provider", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-6esk-secret": "qa-secret"
        },
        body: JSON.stringify({
          jobId: "11111111-1111-1111-1111-111111111111",
          callSessionId: "22222222-2222-2222-2222-222222222222",
          transcriptR2Key: "messages/msg/transcript.txt",
          transcriptText: "Resolved call transcript.",
          metadata: { tenantId: TENANT_ID }
        })
      })
    );

    expect(response.status).toBe(403);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("returns a safe denial when tenant AI provider resolution fails", async () => {
    mocks.getTenantAiProviderConfig.mockRejectedValue(
      new Error("secret decrypt failed for provider key openai-key")
    );
    global.fetch = vi.fn() as typeof fetch;

    const response = await POST(
      new Request("http://localhost/api/internal/calls/transcript-ai/provider", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-6esk-secret": "qa-secret"
        },
        body: JSON.stringify({
          jobId: "11111111-1111-1111-1111-111111111111",
          callSessionId: "22222222-2222-2222-2222-222222222222",
          transcriptR2Key: "messages/msg/transcript.txt",
          transcriptText: "Resolved call transcript.",
          metadata: { tenantId: TENANT_ID }
        })
      })
    );
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ error: AI_PROVIDER_MISCONFIGURED_DENIAL });
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
