import { createHmac } from "crypto";
import {
  createRuntimes,
  InMemoryDatabaseAdapter,
  type IAgentRuntime,
  type Route,
  type RouteRequest,
  type RouteResponse
} from "@elizaos/core";
import project from "@/dexter/index";

export type DexterRuntimeState = "disabled" | "starting" | "active" | "degraded" | "failed";
export type DexterRuntimeMode = "native";

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

export const dexterRuntimes: Map<string, IAgentRuntime> = new Map();

let startPromise: Promise<DexterRuntimeStatus> | null = null;
let runtimeStartedAt: string | null = null;
let runtimeStatus: DexterRuntimeStatus = buildStatus("disabled", {
  enabled: isRuntimeEnabled(),
  activeAgentCount: 0,
  internalDispatcherReady: false,
  startedAt: null,
  failureReason: "DEXTER_RUNTIME_ENABLED is not enabled"
});

function isRuntimeEnabled() {
  const raw = process.env.DEXTER_RUNTIME_ENABLED?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

function buildStatus(
  state: DexterRuntimeState,
  patch: Partial<Omit<DexterRuntimeStatus, "state" | "updatedAt">> = {}
): DexterRuntimeStatus {
  return {
    state,
    enabled: isRuntimeEnabled(),
    mode: "native",
    configuredAgentCount: project.agents.length,
    activeAgentCount: dexterRuntimes.size,
    internalDispatcherReady: hasInternalDispatcher(),
    startedAt: runtimeStartedAt,
    failureReason: null,
    ...patch,
    updatedAt: new Date().toISOString()
  };
}

function setStatus(
  state: DexterRuntimeState,
  patch: Partial<Omit<DexterRuntimeStatus, "state" | "updatedAt">> = {}
) {
  runtimeStatus = buildStatus(state, patch);
  runtimeStartedAt = runtimeStatus.startedAt;
  return runtimeStatus;
}

function findInternalDispatcher(runtime: IAgentRuntime): Route | null {
  return (
    runtime.routes?.find((route) => route.type === "POST" && route.path === "/hooks/6esk/events") ??
    null
  );
}

function hasInternalDispatcher() {
  for (const runtime of dexterRuntimes.values()) {
    if (findInternalDispatcher(runtime)) {
      return true;
    }
  }
  return false;
}

function getRuntimeLogLevel() {
  const value = process.env.DEXTER_RUNTIME_LOG_LEVEL?.trim().toLowerCase();
  return value === "trace" ||
    value === "debug" ||
    value === "info" ||
    value === "warn" ||
    value === "error" ||
    value === "fatal"
    ? value
    : "warn";
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function getDexterRuntimeStatus() {
  return {
    ...runtimeStatus,
    enabled: isRuntimeEnabled(),
    configuredAgentCount: project.agents.length,
    activeAgentCount: dexterRuntimes.size,
    internalDispatcherReady: hasInternalDispatcher()
  } satisfies DexterRuntimeStatus;
}

export async function startDexterRuntime() {
  if (!isRuntimeEnabled()) {
    dexterRuntimes.clear();
    startPromise = null;
    return setStatus("disabled", {
      enabled: false,
      activeAgentCount: 0,
      internalDispatcherReady: false,
      startedAt: null,
      failureReason: "DEXTER_RUNTIME_ENABLED is not enabled"
    });
  }

  if (runtimeStatus.state === "active" || runtimeStatus.state === "degraded") {
    return getDexterRuntimeStatus();
  }
  if (startPromise) {
    return startPromise;
  }

  startPromise = startDexterRuntimeOnce().finally(() => {
    startPromise = null;
  });
  return startPromise;
}

async function startDexterRuntimeOnce() {
  const startedAt = new Date().toISOString();
  setStatus("starting", {
    enabled: true,
    activeAgentCount: 0,
    internalDispatcherReady: false,
    startedAt,
    failureReason: null
  });

  try {
    const adapter = new InMemoryDatabaseAdapter();
    const characters = project.agents.map((agent) => agent.character);
    const runtimes = await createRuntimes(characters, {
      adapter,
      provision: false,
      logLevel: getRuntimeLogLevel(),
      checkShouldRespond: false
    });

    dexterRuntimes.clear();
    for (const runtime of runtimes) {
      dexterRuntimes.set(runtime.agentId, runtime);
    }

    const dispatcherReady = hasInternalDispatcher();
    return setStatus(dispatcherReady ? "active" : "degraded", {
      enabled: true,
      activeAgentCount: dexterRuntimes.size,
      internalDispatcherReady: dispatcherReady,
      startedAt,
      failureReason: dispatcherReady
        ? null
        : "Runtime started but no POST /hooks/6esk/events dispatcher route is registered"
    });
  } catch (error) {
    dexterRuntimes.clear();
    console.error("[Dexter] Failed to start runtime:", error);
    return setStatus("failed", {
      enabled: true,
      activeAgentCount: 0,
      internalDispatcherReady: false,
      startedAt,
      failureReason: errorMessage(error)
    });
  }
}

function signInternalPayload(secret: string, timestamp: string, body: string) {
  const signature = createHmac("sha256", secret)
    .update(`${timestamp}.${body}`)
    .digest("hex");
  return `sha256=${signature}`;
}

function createRouteResponse() {
  let statusCode = 200;
  let responseBody: unknown = null;
  return {
    get ok() {
      return statusCode >= 200 && statusCode < 300;
    },
    get statusCode() {
      return statusCode;
    },
    get body() {
      return responseBody;
    },
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(body: unknown) {
      responseBody = body;
      return this;
    },
    send(body: unknown) {
      responseBody = body;
      return this;
    },
    end() {
      return this;
    }
  } satisfies RouteResponse & { ok: boolean; statusCode: number; body: unknown };
}

export async function processInternalDexterMessage(payload: Record<string, unknown>) {
  const status = getDexterRuntimeStatus();
  if (status.state !== "active") {
    console.warn(
      `[Dexter] Runtime cannot process ${String(payload.event_type ?? "unknown")} while ${status.state}: ${
        status.failureReason ?? "not ready"
      }`
    );
    return false;
  }

  const secret = process.env.SIXESK_SHARED_SECRET?.trim();
  if (!secret) {
    setStatus("degraded", {
      failureReason: "SIXESK_SHARED_SECRET is required for internal Dexter dispatch",
      startedAt: status.startedAt
    });
    return false;
  }

  const body = JSON.stringify(payload);
  const timestamp = new Date().toISOString();
  const headers = {
    "x-6esk-signature": signInternalPayload(secret, timestamp, body),
    "x-6esk-timestamp": timestamp
  };

  const request = {
    headers,
    body: payload,
    rawBody: body,
    method: "POST",
    path: "/hooks/6esk/events",
    url: "internal://dexter/hooks/6esk/events"
  } as RouteRequest & { rawBody: string };

  for (const runtime of dexterRuntimes.values()) {
    const route = findInternalDispatcher(runtime);
    if (!route?.handler) {
      continue;
    }
    const response = createRouteResponse();
    await route.handler(request, response, runtime);
    if (!response.ok) {
      setStatus("degraded", {
        failureReason: `Internal Dexter dispatcher returned HTTP ${response.statusCode}`,
        startedAt: status.startedAt
      });
    }
    return response.ok;
  }

  setStatus("degraded", {
    failureReason: "No POST /hooks/6esk/events dispatcher route is registered",
    startedAt: status.startedAt
  });
  return false;
}

export async function resetDexterRuntimeForTests() {
  if (process.env.NODE_ENV !== "test" && process.env.VITEST !== "true") {
    throw new Error("resetDexterRuntimeForTests is test-only");
  }
  for (const runtime of dexterRuntimes.values()) {
    if (typeof runtime.stop === "function") {
      await runtime.stop();
    }
  }
  dexterRuntimes.clear();
  startPromise = null;
  runtimeStartedAt = null;
  runtimeStatus = buildStatus("disabled", {
    enabled: isRuntimeEnabled(),
    activeAgentCount: 0,
    internalDispatcherReady: false,
    startedAt: null,
    failureReason: "DEXTER_RUNTIME_ENABLED is not enabled"
  });
}
