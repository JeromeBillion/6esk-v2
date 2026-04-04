export const DEMO_MODE_STORAGE_KEY = "sixesk:data-mode";
export const DEMO_MODE_COOKIE_NAME = "sixesk_data_mode";
export const DEMO_MODE_EVENT = "sixesk:demo-mode-change";

export function parseDemoModeValue(value: string | null) {
  if (value === "sample") return true;
  if (value === "live") return false;
  return null;
}

export function serializeDemoModeValue(enabled: boolean) {
  return enabled ? "sample" : "live";
}

export function parseDemoQueryValue(value: string | null | undefined) {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "1" || normalized === "true" || normalized === "sample") return true;
  if (normalized === "0" || normalized === "false" || normalized === "live") return false;
  return null;
}
