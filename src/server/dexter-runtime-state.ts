export type DexterRuntimeState = "disabled" | "starting" | "active" | "degraded" | "failed";
export type DexterRuntimeMode = "native" | "http_bridge";

export type DexterRuntimeStatus = {
  state: DexterRuntimeState;
  enabled: boolean;
  mode: DexterRuntimeMode;
  configuredAgentCount: number;
  activeAgentCount: number;
  internalDispatcherReady: boolean;
  startedAt: string | null;
  updatedAt: string;
  failureReason: string | null;
};

let runtimeStartedAt: string | null = null;

function readRuntimeMode(value: string | undefined): DexterRuntimeMode {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "http_bridge" || normalized === "http-bridge" || normalized === "http") {
    return "http_bridge";
  }
  return "native";
}

export function getDexterRuntimeMode() {
  return readRuntimeMode(process.env.DEXTER_RUNTIME_MODE);
}

function isExplicitlyEnabled(value: string | undefined) {
  if (!value?.trim()) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

export function isDexterRuntimeEnabled() {
  return isExplicitlyEnabled(process.env.DEXTER_RUNTIME_ENABLED);
}

export function getConfiguredDexterAgentCount() {
  if (!isDexterRuntimeEnabled()) return 0;

  let count = 1;
  if (isExplicitlyEnabled(process.env.DEXTER_ENABLE_CRM_AGENT)) count += 1;
  if (isExplicitlyEnabled(process.env.DEXTER_ENABLE_WHATSAPP_AGENT)) count += 1;
  if (isExplicitlyEnabled(process.env.DEXTER_ENABLE_TWITTER_AGENT)) count += 1;
  return count;
}

export function buildDexterRuntimeStatus(
  state: DexterRuntimeState,
  patch: Partial<Omit<DexterRuntimeStatus, "state" | "updatedAt">> = {}
): DexterRuntimeStatus {
  return {
    state,
    enabled: isDexterRuntimeEnabled(),
    mode: getDexterRuntimeMode(),
    configuredAgentCount: getConfiguredDexterAgentCount(),
    activeAgentCount: 0,
    internalDispatcherReady: false,
    startedAt: runtimeStartedAt,
    failureReason: null,
    ...patch,
    updatedAt: new Date().toISOString()
  };
}

let runtimeStatus: DexterRuntimeStatus = buildDexterRuntimeStatus("disabled", {
  enabled: isDexterRuntimeEnabled(),
  startedAt: null,
  failureReason: "DEXTER_RUNTIME_ENABLED is not enabled"
});

export function setDexterRuntimeStatus(
  state: DexterRuntimeState,
  patch: Partial<Omit<DexterRuntimeStatus, "state" | "updatedAt">> = {}
) {
  runtimeStatus = buildDexterRuntimeStatus(state, patch);
  runtimeStartedAt = runtimeStatus.startedAt;
  return runtimeStatus;
}

export function getDexterRuntimeStatus() {
  return {
    ...runtimeStatus,
    enabled: isDexterRuntimeEnabled(),
    configuredAgentCount:
      runtimeStatus.state === "active" || runtimeStatus.state === "degraded"
        ? runtimeStatus.configuredAgentCount
        : getConfiguredDexterAgentCount()
  } satisfies DexterRuntimeStatus;
}

export function markDexterRuntimeDisabled() {
  runtimeStartedAt = null;
  return setDexterRuntimeStatus("disabled", {
    enabled: false,
    configuredAgentCount: getConfiguredDexterAgentCount(),
    activeAgentCount: 0,
    internalDispatcherReady: false,
    startedAt: null,
    failureReason: "DEXTER_RUNTIME_ENABLED is not enabled"
  });
}

export function resetDexterRuntimeStatusForTests() {
  if (process.env.NODE_ENV !== "test" && process.env.VITEST !== "true") {
    throw new Error("resetDexterRuntimeStatusForTests is test-only");
  }
  runtimeStartedAt = null;
  runtimeStatus = buildDexterRuntimeStatus("disabled", {
    enabled: isDexterRuntimeEnabled(),
    activeAgentCount: 0,
    internalDispatcherReady: false,
    startedAt: null,
    failureReason: "DEXTER_RUNTIME_ENABLED is not enabled"
  });
}
