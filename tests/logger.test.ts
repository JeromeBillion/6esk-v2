import { afterEach, describe, expect, it, vi } from "vitest";
import { getRequestContext, logger, requestLogger } from "@/server/logger";

describe("structured logger", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("builds request context without logging query strings", () => {
    const request = new Request("https://app.example.com/api/oauth/callback?code=secret", {
      headers: { "x-request-id": "req-123" }
    });

    expect(getRequestContext(request, { route: "oauth" })).toMatchObject({
      requestId: "req-123",
      method: "GET",
      path: "/api/oauth/callback",
      route: "oauth"
    });
  });

  it("emits structured JSON with request correlation and safe errors", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("LOG_LEVEL", "debug");
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const request = new Request("https://app.example.com/api/cron/sync-mailboxes", {
      headers: { "x-correlation-id": "corr-456" }
    });

    requestLogger(request, { route: "cron" }).error("Cron failed", {
      error: new Error("database unavailable"),
      tenantId: "tenant-1"
    });

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(String(errorSpy.mock.calls[0][0]));
    expect(payload).toMatchObject({
      level: "error",
      msg: "Cron failed",
      requestId: "corr-456",
      method: "GET",
      path: "/api/cron/sync-mailboxes",
      route: "cron",
      tenantId: "tenant-1",
      error: {
        name: "Error",
        message: "database unavailable"
      }
    });
    expect(payload.ts).toEqual(expect.any(String));
  });

  it("lets child loggers inherit and override context", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("LOG_LEVEL", "info");
    const infoSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    logger.child({ tenantId: "tenant-1", provider: "google" }).info("Synced", {
      provider: "microsoft",
      connectionId: "conn-1"
    });

    const payload = JSON.parse(String(infoSpy.mock.calls[0][0]));
    expect(payload).toMatchObject({
      msg: "Synced",
      tenantId: "tenant-1",
      provider: "microsoft",
      connectionId: "conn-1"
    });
  });
});
