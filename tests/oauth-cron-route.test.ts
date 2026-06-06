import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  runSyncEngine: vi.fn()
}));

vi.mock("@/server/oauth/sync-engine", () => ({
  runSyncEngine: mocks.runSyncEngine
}));

import { GET } from "@/app/api/cron/sync-mailboxes/route";

describe("GET /api/cron/sync-mailboxes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    mocks.runSyncEngine.mockResolvedValue(undefined);
  });

  it("fails closed in production when CRON_SECRET is not configured", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CRON_SECRET", "");

    const response = await GET(new Request("https://app.example.com/api/cron/sync-mailboxes") as any);

    expect(response.status).toBe(503);
    expect(mocks.runSyncEngine).not.toHaveBeenCalled();
  });

  it("rejects incorrect bearer tokens when CRON_SECRET is configured", async () => {
    vi.stubEnv("CRON_SECRET", "correct-secret");

    const response = await GET(new Request("https://app.example.com/api/cron/sync-mailboxes", {
      headers: { authorization: "Bearer wrong-secret" }
    }) as any);

    expect(response.status).toBe(401);
    expect(mocks.runSyncEngine).not.toHaveBeenCalled();
  });

  it("runs sync for a valid bearer token", async () => {
    vi.stubEnv("CRON_SECRET", "correct-secret");

    const response = await GET(new Request("https://app.example.com/api/cron/sync-mailboxes", {
      headers: { authorization: "Bearer correct-secret" }
    }) as any);

    expect(response.status).toBe(200);
    expect(mocks.runSyncEngine).toHaveBeenCalledTimes(1);
  });
});
