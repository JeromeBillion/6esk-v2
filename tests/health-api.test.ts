import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dbQuery: vi.fn(),
  getDexterRuntimeStatus: vi.fn()
}));

vi.mock("@/server/db", () => ({
  db: {
    query: mocks.dbQuery
  }
}));

vi.mock("@/server/dexter-runtime", () => ({
  getDexterRuntimeStatus: mocks.getDexterRuntimeStatus
}));

import { GET } from "@/app/api/health/route";

describe("GET /api/health", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.dbQuery.mockResolvedValue({ rows: [{ ok: 1 }] });
    mocks.getDexterRuntimeStatus.mockReturnValue({
      state: "disabled",
      enabled: false,
      mode: "native",
      configuredAgentCount: 1,
      activeAgentCount: 0,
      internalDispatcherReady: false,
      startedAt: null,
      updatedAt: "2026-05-09T10:00:00.000Z",
      failureReason: "DEXTER_RUNTIME_ENABLED is not enabled"
    });
  });

  it("reports database and disabled Dexter runtime as healthy", async () => {
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      status: "ok",
      service: "6esk",
      checks: {
        database: { status: "ok" },
        dexterRuntime: {
          status: "disabled",
          enabled: false,
          state: "disabled"
        }
      }
    });
  });

  it("marks the service degraded when enabled Dexter runtime is not active", async () => {
    mocks.getDexterRuntimeStatus.mockReturnValue({
      state: "failed",
      enabled: true,
      mode: "native",
      configuredAgentCount: 1,
      activeAgentCount: 0,
      internalDispatcherReady: false,
      startedAt: "2026-05-09T10:00:00.000Z",
      updatedAt: "2026-05-09T10:00:01.000Z",
      failureReason: "model provider missing"
    });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      status: "degraded",
      checks: {
        dexterRuntime: {
          status: "degraded",
          enabled: true,
          state: "failed",
          internalDispatcherReady: false
        }
      }
    });
    expect(JSON.stringify(body)).not.toContain("model provider missing");
  });

  it("returns 503 when the database check fails", async () => {
    mocks.dbQuery.mockRejectedValueOnce(new Error("db down"));

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toMatchObject({ status: "degraded", service: "6esk" });
  });
});
