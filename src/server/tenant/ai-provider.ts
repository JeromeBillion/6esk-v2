import { getTenantById } from "./lifecycle";
import { getGlobalAiProviderConfig, type GlobalAiProviderConfig } from "@/server/ai/global-provider";
import { decrypt } from "@/server/security/encryption";
import type { ModuleUsageProviderMode } from "@/server/module-metering";

export type TenantAiProviderConfig = GlobalAiProviderConfig & {
  providerMode: ModuleUsageProviderMode;
};

/**
 * Resolves the AI provider configuration for a specific tenant.
 * Uses the global managed keys by default, unless the tenant is explicitly 
 * configured for BYO mode and has an active API key stored in settings.
 */
export async function getTenantAiProviderConfig(tenantId: string): Promise<TenantAiProviderConfig> {
  const globalConfig = getGlobalAiProviderConfig();
  const tenant = await getTenantById(tenantId);
  
  if (!tenant) {
    return { ...globalConfig, providerMode: "managed" };
  }

  const settings = tenant.settings || {};
  const providerMode = (settings.aiProviderMode as ModuleUsageProviderMode) || "managed";

  if (providerMode === "byo") {
    const customApiKeyEncrypted = settings.aiProviderApiKey as string | undefined;
    
    if (customApiKeyEncrypted) {
      try {
        const customApiKey = decrypt(customApiKeyEncrypted);
        const customBaseUrl = settings.aiProviderBaseUrl as string | undefined;
        const customModel = settings.aiProviderModel as string | undefined;

        return {
          provider: "openai", // Assume openai-compatible
          model: customModel || globalConfig.model,
          apiKey: customApiKey,
          baseUrl: customBaseUrl || globalConfig.baseUrl,
          providerMode
        };
      } catch (err) {
        console.error(`[AI Provider] Failed to decrypt BYO key for tenant ${tenantId}`, err);
        // Fallback to managed if decryption fails
      }
    }
  }

  if (providerMode === "none") {
    return { ...globalConfig, providerMode: "none" };
  }

  return { ...globalConfig, providerMode: "managed" };
}
