import { createHmac } from "crypto";
import {
  getDexterRuntimeMode,
  getDexterRuntimeStatus,
  isDexterRuntimeEnabled,
  markDexterRuntimeDisabled,
  resetDexterRuntimeStatusForTests,
  setDexterRuntimeStatus,
  type DexterRuntimeStatus
} from "@/server/dexter-runtime-state";
import { logger } from "@/server/logger";

type NativeDexterRuntime = typeof import("@/server/dexter-runtime-native");

let nativeRuntime: NativeDexterRuntime | null = null;
let nativeRuntimePromise: Promise<NativeDexterRuntime> | null = null;

async function loadNativeRuntime() {
  if (nativeRuntime) return nativeRuntime;
  if (!nativeRuntimePromise) {
    nativeRuntimePromise = import("@/server/dexter-runtime-native").then((module) => {
      nativeRuntime = module;
      return module;
    });
  }
  return nativeRuntimePromise;
}

export { getDexterRuntimeStatus };
export type { DexterRuntimeStatus };

export async function startDexterRuntime() {
  if (!isDexterRuntimeEnabled()) {
    if (nativeRuntime) {
      await nativeRuntime.stopNativeDexterRuntime();
    }
    nativeRuntimePromise = null;
    nativeRuntime = null;
    return markDexterRuntimeDisabled();
  }

  if (getDexterRuntimeMode() === "http_bridge") {
    if (nativeRuntime) {
      await nativeRuntime.stopNativeDexterRuntime();
    }
    nativeRuntimePromise = null;
    nativeRuntime = null;
    return startDexterHttpBridge();
  }

  try {
    const runtime = await loadNativeRuntime();
    return runtime.startNativeDexterRuntime();
  } catch (error) {
    nativeRuntime = null;
    nativeRuntimePromise = null;
    return markDexterRuntimeFailedWithoutNative(error);
  }
}

export async function processInternalDexterMessage(payload: Record<string, unknown>) {
  const status = getDexterRuntimeStatus();
  if (status.state !== "active") {
    logger.warn("Dexter runtime cannot process message while inactive", {
      eventType: String(payload.event_type ?? "unknown"),
      state: status.state,
      failureReason: status.failureReason
    });
    return false;
  }

  if (status.mode === "http_bridge") {
    return postToDexterHttpBridge(payload);
  }

  const runtime = await loadNativeRuntime();
  return runtime.processNativeInternalDexterMessage(payload);
}

export async function resetDexterRuntimeForTests() {
  if (process.env.NODE_ENV !== "test" && process.env.VITEST !== "true") {
    throw new Error("resetDexterRuntimeForTests is test-only");
  }
  if (nativeRuntime) {
    await nativeRuntime.resetNativeDexterRuntimeForTests();
  }
  nativeRuntime = null;
  nativeRuntimePromise = null;
  resetDexterRuntimeStatusForTests();
}

function markDexterRuntimeFailedWithoutNative(error: unknown) {
  const failureReason = error instanceof Error ? error.message : String(error);
  return setDexterRuntimeStatus("failed", {
    enabled: isDexterRuntimeEnabled(),
    activeAgentCount: 0,
    internalDispatcherReady: false,
    failureReason
  });
}

function readString(value: string | undefined) {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function getDexterBridgeConfig() {
  return {
    url: readString(process.env.DEXTER_RUNTIME_HTTP_URL),
    secret:
      readString(process.env.DEXTER_RUNTIME_HTTP_SECRET) ??
      readString(process.env.SIXESK_SHARED_SECRET),
    timeoutMs: Math.max(
      1000,
      Number.parseInt(process.env.DEXTER_RUNTIME_HTTP_TIMEOUT_MS ?? "7000", 10) || 7000
    )
  };
}

function signBridgePayload(secret: string, timestamp: string, body: string) {
  const signature = createHmac("sha256", secret)
    .update(`${timestamp}.${body}`)
    .digest("hex");
  return `sha256=${signature}`;
}

function createBridgeHeaders(secret: string, body: string) {
  const timestamp = new Date().toISOString();
  return {
    "content-type": "application/json",
    "x-6esk-timestamp": timestamp,
    "x-6esk-signature": signBridgePayload(secret, timestamp, body)
  };
}

function createAbortSignal(timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    clear() {
      clearTimeout(timeout);
    }
  };
}

async function startDexterHttpBridge() {
  const config = getDexterBridgeConfig();
  if (!config.url) {
    return setDexterRuntimeStatus("failed", {
      enabled: true,
      activeAgentCount: 0,
      internalDispatcherReady: false,
      failureReason: "DEXTER_RUNTIME_HTTP_URL is required when DEXTER_RUNTIME_MODE=http_bridge"
    });
  }
  if (!config.secret) {
    return setDexterRuntimeStatus("failed", {
      enabled: true,
      activeAgentCount: 0,
      internalDispatcherReady: false,
      failureReason:
        "DEXTER_RUNTIME_HTTP_SECRET or SIXESK_SHARED_SECRET is required when DEXTER_RUNTIME_MODE=http_bridge"
    });
  }

  const startedAt = new Date().toISOString();
  const body = JSON.stringify({
    command: "runtime.status"
  });
  const { signal, clear } = createAbortSignal(config.timeoutMs);
  try {
    const response = await fetch(new URL("/runtime/status", config.url).toString(), {
      method: "POST",
      headers: createBridgeHeaders(config.secret, body),
      body,
      signal
    });
    if (!response.ok) {
      return setDexterRuntimeStatus("degraded", {
        enabled: true,
        activeAgentCount: 0,
        internalDispatcherReady: false,
        startedAt,
        failureReason: `Dexter runtime bridge status check failed (${response.status})`
      });
    }

    const payload = (await response.json().catch(() => ({}))) as {
      activeAgentCount?: number;
      internalDispatcherReady?: boolean;
    };
    return setDexterRuntimeStatus("active", {
      enabled: true,
      activeAgentCount:
        typeof payload.activeAgentCount === "number" ? payload.activeAgentCount : 1,
      internalDispatcherReady:
        typeof payload.internalDispatcherReady === "boolean"
          ? payload.internalDispatcherReady
          : true,
      startedAt,
      failureReason: null
    });
  } catch (error) {
    const failureReason = error instanceof Error ? error.message : String(error);
    return setDexterRuntimeStatus("failed", {
      enabled: true,
      activeAgentCount: 0,
      internalDispatcherReady: false,
      startedAt,
      failureReason: `Dexter runtime bridge unavailable: ${failureReason}`
    });
  } finally {
    clear();
  }
}

async function postToDexterHttpBridge(payload: Record<string, unknown>) {
  const status = getDexterRuntimeStatus();
  const config = getDexterBridgeConfig();
  if (!config.url || !config.secret) {
    setDexterRuntimeStatus("degraded", {
      enabled: true,
      activeAgentCount: 0,
      internalDispatcherReady: false,
      startedAt: status.startedAt,
      failureReason:
        "Dexter runtime bridge configuration missing: DEXTER_RUNTIME_HTTP_URL and DEXTER_RUNTIME_HTTP_SECRET"
    });
    return false;
  }

  const body = JSON.stringify(payload);
  const { signal, clear } = createAbortSignal(config.timeoutMs);
  try {
    const response = await fetch(new URL("/hooks/6esk/events", config.url).toString(), {
      method: "POST",
      headers: createBridgeHeaders(config.secret, body),
      body,
      signal
    });
    if (!response.ok) {
      setDexterRuntimeStatus("degraded", {
        enabled: true,
        activeAgentCount: status.activeAgentCount,
        internalDispatcherReady: false,
        startedAt: status.startedAt,
        failureReason: `Dexter runtime bridge rejected event (${response.status})`
      });
      return false;
    }
    return true;
  } catch (error) {
    const failureReason = error instanceof Error ? error.message : String(error);
    setDexterRuntimeStatus("degraded", {
      enabled: true,
      activeAgentCount: status.activeAgentCount,
      internalDispatcherReady: false,
      startedAt: status.startedAt,
      failureReason: `Dexter runtime bridge event delivery failed: ${failureReason}`
    });
    return false;
  } finally {
    clear();
  }
}
