import { getTenantById } from "./lifecycle";
import { getGlobalAiProviderConfig, type GlobalAiProviderConfig } from "@/server/ai/global-provider";
import { decrypt } from "@/server/security/encryption";
import type { ModuleUsageProviderMode } from "@/server/module-metering";

export type ActiveTenantAiProviderConfig = GlobalAiProviderConfig & {
  providerMode: Exclude<ModuleUsageProviderMode, "none">;
};

export type DisabledTenantAiProviderConfig = {
  provider: "none";
  model: "";
  apiKey: "";
  baseUrl: "";
  providerMode: "none";
};

export type TenantAiProviderConfig = ActiveTenantAiProviderConfig | DisabledTenantAiProviderConfig;

function readString(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

function normalizeProviderMode(value: unknown): ModuleUsageProviderMode {
  const normalized = readString(value)?.toLowerCase();
  if (normalized === "byo" || normalized === "none" || normalized === "managed") {
    return normalized;
  }
  return "managed";
}

function getDefaultAiModel() {
  return readString(process.env.AI_MODEL) ?? readString(process.env.CALLS_TRANSCRIPT_AI_OPENAI_MODEL) ?? "gpt-5-mini";
}

function getDefaultAiBaseUrl() {
  return trimTrailingSlash(readString(process.env.AI_BASE_URL) ?? "https://api.openai.com/v1");
}

/**
 * Resolves the AI provider configuration for a specific tenant.
 * Uses the global managed keys by default, unless the tenant is explicitly 
 * configured for BYO mode and has an active API key stored in settings.
 */
export async function getTenantAiProviderConfig(tenantId: string): Promise<TenantAiProviderConfig> {
  const tenant = await getTenantById(tenantId);

  if (!tenant) {
    throw new Error("Tenant AI provider configuration was requested for an unknown tenant.");
  }

  const settings = tenant.settings || {};
  const providerMode = normalizeProviderMode(settings.aiProviderMode);

  if (providerMode === "none") {
    return {
      provider: "none",
      model: "",
      apiKey: "",
      baseUrl: "",
      providerMode: "none"
    };
  }

  if (providerMode === "byo") {
    const customApiKeyEncrypted = settings.aiProviderApiKey as string | undefined;

    if (!customApiKeyEncrypted) {
      throw new Error("Tenant AI provider is in BYO mode but no API key is configured.");
    }

    try {
      const customApiKey = decrypt(customApiKeyEncrypted);
      const customBaseUrl = readString(settings.aiProviderBaseUrl);
      const customModel = readString(settings.aiProviderModel);

      return {
        provider: "openai", // OpenAI-compatible provider contract.
        model: customModel || getDefaultAiModel(),
        apiKey: customApiKey,
        baseUrl: customBaseUrl ? trimTrailingSlash(customBaseUrl) : getDefaultAiBaseUrl(),
        providerMode: "byo"
      };
    } catch (err) {
      console.error(`[AI Provider] Failed to decrypt BYO key for tenant ${tenantId}`, err);
      throw new Error("Tenant BYO AI provider key could not be decrypted.");
    }
  }

  const globalConfig = getGlobalAiProviderConfig();
  return { ...globalConfig, providerMode: "managed" };
}
