import { createHmac } from "crypto";
import type {
  IAgentRuntime,
  Route,
  RouteRequest,
  RouteResponse
} from "@elizaos/core";
import project from "@/dexter/index";
import {
  getDexterRuntimeStatus,
  setDexterRuntimeStatus,
  type DexterRuntimeStatus
} from "@/server/dexter-runtime-state";
import { logger } from "@/server/logger";

export const dexterRuntimes: Map<string, IAgentRuntime> = new Map();

let startPromise: Promise<DexterRuntimeStatus> | null = null;

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

export async function stopNativeDexterRuntime() {
  for (const runtime of dexterRuntimes.values()) {
    if (typeof runtime.stop === "function") {
      await runtime.stop();
    }
  }
  dexterRuntimes.clear();
  startPromise = null;
}

export async function startNativeDexterRuntime() {
  const status = getDexterRuntimeStatus();
  if (status.state === "active" || status.state === "degraded") {
    return {
      ...status,
      activeAgentCount: dexterRuntimes.size,
      internalDispatcherReady: hasInternalDispatcher()
    };
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
  setDexterRuntimeStatus("starting", {
    enabled: true,
    configuredAgentCount: project.agents.length,
    activeAgentCount: 0,
    internalDispatcherReady: false,
    startedAt,
    failureReason: null
  });

  try {
    const { createRuntimes, InMemoryDatabaseAdapter } = await import("@elizaos/core");
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
    return setDexterRuntimeStatus(dispatcherReady ? "active" : "degraded", {
      enabled: true,
      configuredAgentCount: project.agents.length,
      activeAgentCount: dexterRuntimes.size,
      internalDispatcherReady: dispatcherReady,
      startedAt,
      failureReason: dispatcherReady
        ? null
        : "Runtime started but no POST /hooks/6esk/events dispatcher route is registered"
    });
  } catch (error) {
    dexterRuntimes.clear();
    logger.error("Dexter native runtime failed to start", { error });
    return setDexterRuntimeStatus("failed", {
      enabled: true,
      configuredAgentCount: project.agents.length,
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

export async function processNativeInternalDexterMessage(payload: Record<string, unknown>) {
  const status = getDexterRuntimeStatus();
  const secret = process.env.SIXESK_SHARED_SECRET?.trim();
  if (!secret) {
    setDexterRuntimeStatus("degraded", {
      failureReason: "SIXESK_SHARED_SECRET is required for internal Dexter dispatch",
      startedAt: status.startedAt,
      configuredAgentCount: status.configuredAgentCount,
      activeAgentCount: dexterRuntimes.size,
      internalDispatcherReady: hasInternalDispatcher()
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
      setDexterRuntimeStatus("degraded", {
        failureReason: `Internal Dexter dispatcher returned HTTP ${response.statusCode}`,
        startedAt: status.startedAt,
        configuredAgentCount: status.configuredAgentCount,
        activeAgentCount: dexterRuntimes.size,
        internalDispatcherReady: hasInternalDispatcher()
      });
    }
    return response.ok;
  }

  setDexterRuntimeStatus("degraded", {
    failureReason: "No POST /hooks/6esk/events dispatcher route is registered",
    startedAt: status.startedAt,
    configuredAgentCount: status.configuredAgentCount,
    activeAgentCount: dexterRuntimes.size,
    internalDispatcherReady: false
  });
  return false;
}

export async function resetNativeDexterRuntimeForTests() {
  if (process.env.NODE_ENV !== "test" && process.env.VITEST !== "true") {
    throw new Error("resetNativeDexterRuntimeForTests is test-only");
  }
  await stopNativeDexterRuntime();
}
