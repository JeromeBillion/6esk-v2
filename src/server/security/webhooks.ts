export function isProductionLikeRuntime() {
  return process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production";
}

export function isExplicitlyEnabled(value: string | null | undefined) {
  return /^(1|true|yes|on)$/i.test((value ?? "").trim());
}

export function canAcceptUnsignedWebhookTraffic(allowEnvValue?: string | null) {
  if (isProductionLikeRuntime()) {
    return isExplicitlyEnabled(allowEnvValue);
  }
  return true;
}
