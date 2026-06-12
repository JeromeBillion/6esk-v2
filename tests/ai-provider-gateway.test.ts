import { beforeEach, describe, expect, it, vi } from "vitest";

const TENANT_ID = "00000000-0000-0000-0000-000000000001";

const mocks = vi.hoisted(() => ({
  getTenantAiProviderConfig: vi.fn()
}));

vi.mock("@/server/tenant/ai-provider", () => ({
  getTenantAiProviderConfig: mocks.getTenantAiProviderConfig
}));

import {
  AI_PROVIDER_MISCONFIGURED_DENIAL,
  getAiProviderResponsesUrl,
  getAiProviderTimeoutMs,
  resolveTenantAiProviderPlan
} from "@/server/ai/provider-gateway";

describe("AI provider gateway", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a ready managed plan with timeout, fallback models, and cost metadata", async () => {
    mocks.getTenantAiProviderConfig.mockResolvedValue({
      provider: "openai",
      model: "gpt-5-mini",
      apiKey: "managed-key",
      baseUrl: "https://api.openai.com/v1",
      providerMode: "managed"
    });

    const plan = await resolveTenantAiProviderPlan(TENANT_ID, {
      AI_PROVIDER_TIMEOUT_MS: "25000",
      AI_FALLBACK_MODELS: "gpt-5-mini,gpt-5-nano, gpt-5-mini, gpt-4.1-mini"
    } as NodeJS.ProcessEnv);

    expect(plan).toMatchObject({
      tenantId: TENANT_ID,
      status: "ready",
      provider: "openai",
      model: "gpt-5-mini",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "managed-key",
      providerMode: "managed",
      timeoutMs: 25000,
      fallbackModels: ["gpt-5-nano", "gpt-4.1-mini"],
      costCapture: {
        moduleKey: "aiAutomation",
        unit: "tokens",
        providerMode: "managed"
      }
    });
    if (plan.status === "ready") {
      expect(getAiProviderResponsesUrl(plan)).toBe("https://api.openai.com/v1/responses");
    }
  });

  it("returns disabled plans without credentials when tenant AI mode is none", async () => {
    mocks.getTenantAiProviderConfig.mockResolvedValue({
      provider: "none",
      model: "",
      apiKey: "",
      baseUrl: "",
      providerMode: "none"
    });

    const plan = await resolveTenantAiProviderPlan(TENANT_ID);

    expect(plan).toMatchObject({
      status: "disabled",
      providerMode: "none",
      provider: "none",
      apiKey: "",
      denialReason: "Tenant AI provider is disabled."
    });
  });

  it("returns a misconfigured plan instead of throwing provider secrets", async () => {
    mocks.getTenantAiProviderConfig.mockRejectedValue(new Error("Tenant BYO AI provider key could not be decrypted."));

    const plan = await resolveTenantAiProviderPlan(TENANT_ID, {
      AI_PROVIDER_TIMEOUT_MS: "not-a-number"
    } as NodeJS.ProcessEnv);

    expect(plan).toMatchObject({
      status: "misconfigured",
      provider: "unknown",
      model: "",
      apiKey: "",
      providerMode: "none",
      timeoutMs: 15000,
      denialReason: AI_PROVIDER_MISCONFIGURED_DENIAL
    });
  });

  it("bounds provider timeout configuration", () => {
    expect(getAiProviderTimeoutMs({ AI_PROVIDER_TIMEOUT_MS: "50" } as NodeJS.ProcessEnv)).toBe(1000);
    expect(getAiProviderTimeoutMs({ AI_PROVIDER_TIMEOUT_MS: "120000" } as NodeJS.ProcessEnv)).toBe(60000);
    expect(getAiProviderTimeoutMs({ CALLS_TRANSCRIPT_AI_PROVIDER_TIMEOUT_MS: "9000" } as NodeJS.ProcessEnv)).toBe(9000);
  });
});
