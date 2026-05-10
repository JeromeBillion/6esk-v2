import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createRuntimes: vi.fn()
}));

vi.mock("@elizaos/core", () => ({
  createRuntimes: mocks.createRuntimes,
  InMemoryDatabaseAdapter: class InMemoryDatabaseAdapter {}
}));

vi.mock("@/dexter/index", () => ({
  default: {
    agents: [{ character: { name: "Dexter CRM" } }]
  }
}));

const originalRuntimeEnabled = process.env.DEXTER_RUNTIME_ENABLED;
const originalSharedSecret = process.env.SIXESK_SHARED_SECRET;

async function loadRuntimeModule() {
  vi.resetModules();
  return import("@/server/dexter-runtime");
}

function restoreEnv() {
  if (originalRuntimeEnabled === undefined) {
    delete process.env.DEXTER_RUNTIME_ENABLED;
  } else {
    process.env.DEXTER_RUNTIME_ENABLED = originalRuntimeEnabled;
  }

  if (originalSharedSecret === undefined) {
    delete process.env.SIXESK_SHARED_SECRET;
  } else {
    process.env.SIXESK_SHARED_SECRET = originalSharedSecret;
  }
}

describe("Dexter runtime lifecycle", () => {
  beforeEach(() => {
    restoreEnv();
    vi.clearAllMocks();
  });

  afterEach(() => {
    restoreEnv();
  });

  it("stays disabled by default and does not create runtimes", async () => {
    delete process.env.DEXTER_RUNTIME_ENABLED;
    const { startDexterRuntime, processInternalDexterMessage } = await loadRuntimeModule();

    const status = await startDexterRuntime();
    const processed = await processInternalDexterMessage({
      event_type: "ticket.message.created",
      resource: { ticket_id: "ticket-1" }
    });

    expect(status).toMatchObject({
      state: "disabled",
      enabled: false,
      activeAgentCount: 0,
      internalDispatcherReady: false
    });
    expect(processed).toBe(false);
    expect(mocks.createRuntimes).not.toHaveBeenCalled();
  });

  it("reports degraded when the native runtime has no 6esk dispatcher", async () => {
    process.env.DEXTER_RUNTIME_ENABLED = "true";
    mocks.createRuntimes.mockResolvedValueOnce([
      {
        agentId: "11111111-1111-4111-8111-111111111111",
        routes: [],
        stop: vi.fn()
      }
    ]);
    const { startDexterRuntime, getDexterRuntimeStatus } = await loadRuntimeModule();

    const status = await startDexterRuntime();

    expect(status).toMatchObject({
      state: "degraded",
      enabled: true,
      configuredAgentCount: 1,
      activeAgentCount: 1,
      internalDispatcherReady: false
    });
    expect(status.failureReason).toContain("/hooks/6esk/events");
    expect(getDexterRuntimeStatus()).toMatchObject(status);
  });

  it("dispatches internal events only after the runtime is active", async () => {
    process.env.DEXTER_RUNTIME_ENABLED = "true";
    process.env.SIXESK_SHARED_SECRET = "super-secret";
    const handler = vi.fn(async (req, res) => {
      res.status(202).json({
        signature: req.headers?.["x-6esk-signature"],
        body: req.body
      });
    });
    mocks.createRuntimes.mockResolvedValueOnce([
      {
        agentId: "11111111-1111-4111-8111-111111111111",
        routes: [{ type: "POST", path: "/hooks/6esk/events", handler }],
        stop: vi.fn()
      }
    ]);
    const { startDexterRuntime, processInternalDexterMessage } = await loadRuntimeModule();

    await startDexterRuntime();
    const processed = await processInternalDexterMessage({
      event_type: "ticket.message.created",
      resource: { ticket_id: "ticket-1" }
    });

    expect(processed).toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].headers["x-6esk-signature"]).toMatch(/^sha256=/);
    expect(handler.mock.calls[0][0].rawBody).toContain("ticket.message.created");
  });

  it("fails closed when runtime creation throws", async () => {
    process.env.DEXTER_RUNTIME_ENABLED = "true";
    mocks.createRuntimes.mockRejectedValueOnce(new Error("model provider missing"));
    const { startDexterRuntime, processInternalDexterMessage } = await loadRuntimeModule();

    const status = await startDexterRuntime();
    const processed = await processInternalDexterMessage({
      event_type: "ticket.message.created",
      resource: { ticket_id: "ticket-1" }
    });

    expect(status).toMatchObject({
      state: "failed",
      enabled: true,
      activeAgentCount: 0,
      internalDispatcherReady: false,
      failureReason: "model provider missing"
    });
    expect(processed).toBe(false);
  });
});
