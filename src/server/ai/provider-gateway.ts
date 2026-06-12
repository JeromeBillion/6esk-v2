import { getGlobalAiResponsesUrl } from "@/server/ai/global-provider";
import {
  getTenantAiProviderConfig,
  type ActiveTenantAiProviderConfig
} from "@/server/tenant/ai-provider";
import type { ModuleUsageProviderMode } from "@/server/module-metering";

export type AiProviderGatewayStatus = "ready" | "disabled" | "misconfigured";

export const AI_PROVIDER_MISCONFIGURED_DENIAL =
  "Tenant AI provider is not configured or could not be resolved.";

type AiProviderGatewayBase = {
  tenantId: string;
  status: AiProviderGatewayStatus;
  providerMode: ModuleUsageProviderMode;
  timeoutMs: number;
  fallbackModels: string[];
  costCapture: {
    moduleKey: "aiAutomation";
    unit: "tokens";
    providerMode: ModuleUsageProviderMode;
  };
};

export type ReadyAiProviderPlan = AiProviderGatewayBase & {
  status: "ready";
  provider: string;
  model: string;
  baseUrl: string;
  apiKey: string;
  denialReason: null;
};

export type DisabledAiProviderPlan = AiProviderGatewayBase & {
  status: "disabled";
  providerMode: "none";
  provider: "none";
  model: "";
  baseUrl: "";
  apiKey: "";
  denialReason: string;
};

export type MisconfiguredAiProviderPlan = AiProviderGatewayBase & {
  status: "misconfigured";
  provider: "unknown";
  model: "";
  baseUrl: "";
  apiKey: "";
  denialReason: string;
};

export type AiProviderPlan =
  | ReadyAiProviderPlan
  | DisabledAiProviderPlan
  | MisconfiguredAiProviderPlan;

function readString(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function readPositiveInteger(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function readFallbackModels(primaryModel: string, env: NodeJS.ProcessEnv = process.env) {
  const values = readString(env.AI_FALLBACK_MODELS) ?? readString(env.CALLS_TRANSCRIPT_AI_FALLBACK_MODELS);
  if (!values) return [];
  return Array.from(
    new Set(
      values
        .split(",")
        .map((item) => item.trim())
        .filter((item) => item && item !== primaryModel)
    )
  ).slice(0, 5);
}

export function getAiProviderTimeoutMs(env: NodeJS.ProcessEnv = process.env) {
  return readPositiveInteger(
    readString(env.AI_PROVIDER_TIMEOUT_MS) ?? readString(env.CALLS_TRANSCRIPT_AI_PROVIDER_TIMEOUT_MS),
    15000,
    1000,
    60000
  );
}

function basePlan<
  const TStatus extends AiProviderGatewayStatus,
  const TProviderMode extends ModuleUsageProviderMode
>(input: {
  tenantId: string;
  status: TStatus;
  providerMode: TProviderMode;
  timeoutMs: number;
  fallbackModels: string[];
}): AiProviderGatewayBase & {
  status: TStatus;
  providerMode: TProviderMode;
  costCapture: AiProviderGatewayBase["costCapture"] & {
    providerMode: TProviderMode;
  };
} {
  return {
    tenantId: input.tenantId,
    status: input.status,
    providerMode: input.providerMode,
    timeoutMs: input.timeoutMs,
    fallbackModels: input.fallbackModels,
    costCapture: {
      moduleKey: "aiAutomation" as const,
      unit: "tokens" as const,
      providerMode: input.providerMode
    }
  };
}

export async function resolveTenantAiProviderPlan(
  tenantId: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<AiProviderPlan> {
  const timeoutMs = getAiProviderTimeoutMs(env);

  try {
    const config = await getTenantAiProviderConfig(tenantId);
    if (config.providerMode === "none") {
      return {
        ...basePlan({
          tenantId,
          status: "disabled",
          providerMode: "none",
          timeoutMs,
          fallbackModels: []
        }),
        provider: "none",
        model: "",
        baseUrl: "",
        apiKey: "",
        denialReason: "Tenant AI provider is disabled."
      };
    }

    const activeConfig = config as ActiveTenantAiProviderConfig;
    return {
      ...basePlan({
        tenantId,
        status: "ready",
        providerMode: activeConfig.providerMode,
        timeoutMs,
        fallbackModels: readFallbackModels(activeConfig.model, env)
      }),
      provider: activeConfig.provider,
      model: activeConfig.model,
      baseUrl: activeConfig.baseUrl,
      apiKey: activeConfig.apiKey,
      denialReason: null
    };
  } catch {
    return {
      ...basePlan({
        tenantId,
        status: "misconfigured",
        providerMode: "none",
        timeoutMs,
        fallbackModels: []
      }),
      provider: "unknown",
      model: "",
      baseUrl: "",
      apiKey: "",
      denialReason: AI_PROVIDER_MISCONFIGURED_DENIAL
    };
  }
}

export function getAiProviderResponsesUrl(plan: ReadyAiProviderPlan) {
  return getGlobalAiResponsesUrl(plan);
}

export function createAiProviderAbortSignal(timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    clear() {
      clearTimeout(timeout);
    }
  };
}
