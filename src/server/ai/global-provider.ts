function readString(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

export type GlobalAiProviderConfig = {
  provider: string;
  model: string;
  apiKey: string;
  baseUrl: string;
};

export function getGlobalAiProviderConfig(): GlobalAiProviderConfig {
  const provider =
    readString(process.env.AI_PROVIDER) ??
    readString(process.env.LLM_PROVIDER) ??
    "openai";
  const model =
    readString(process.env.AI_MODEL) ??
    readString(process.env.CALLS_TRANSCRIPT_AI_OPENAI_MODEL) ??
    "gpt-5-mini";
  const apiKey = readString(process.env.AI_API_KEY) ?? readString(process.env.OPENAI_API_KEY);
  if (!apiKey) {
    throw new Error("AI_API_KEY or OPENAI_API_KEY is not configured.");
  }

  const baseUrl = trimTrailingSlash(
    readString(process.env.AI_BASE_URL) ?? "https://api.openai.com/v1"
  );

  return {
    provider,
    model,
    apiKey,
    baseUrl
  };
}

export function getGlobalAiResponsesUrl(config: GlobalAiProviderConfig) {
  return `${config.baseUrl}/responses`;
}
