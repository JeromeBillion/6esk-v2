import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const clientQuery = vi.fn(async () => ({ rows: [{ ok: 1 }] }));
  const done = vi.fn();
  const rawConnect = vi.fn((callback?: unknown) => {
    const client = { query: clientQuery };
    if (typeof callback === "function") {
      callback(undefined, client, done);
      return undefined;
    }
    return Promise.resolve(client);
  });
  const enforceTenantQueryGuard = vi.fn();

  class MockPool {
    __tenantQueryGuardWrapped?: boolean;
    __tenantQueryGuardConnectWrapped?: boolean;

    connect = rawConnect;

    query(queryText: unknown, ...args: unknown[]) {
      return new Promise((resolve, reject) => {
        this.connect(
          (
            err: Error | undefined,
            client:
              | {
                  query: (queryText: unknown, ...args: unknown[]) => Promise<unknown>;
                }
              | undefined,
            release: () => void
          ) => {
            if (err || !client) {
              reject(err ?? new Error("Missing pg client"));
              return;
            }
            client.query(queryText, ...args).then(resolve, reject).finally(release);
          }
        );
      });
    }
  }

  return {
    clientQuery,
    done,
    enforceTenantQueryGuard,
    rawConnect,
    MockPool
  };
});

vi.mock("pg", () => ({ Pool: mocks.MockPool }));
vi.mock("@/server/tenant-query-guard", () => ({
  enforceTenantQueryGuard: mocks.enforceTenantQueryGuard
}));

describe("db pool wrapper", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.clientQuery.mockClear();
    mocks.done.mockClear();
    mocks.enforceTenantQueryGuard.mockClear();
    mocks.rawConnect.mockClear();
    delete (globalThis as { pool?: unknown }).pool;
  });

  it("preserves pg pool.query's callback-based connect path", async () => {
    const { db } = await import("@/server/db");

    await expect(db.query("SELECT 1")).resolves.toEqual({ rows: [{ ok: 1 }] });

    expect(mocks.rawConnect).toHaveBeenCalledWith(expect.any(Function));
    expect(mocks.clientQuery).toHaveBeenCalledWith("SELECT 1");
    expect(mocks.done).toHaveBeenCalled();
    expect(mocks.enforceTenantQueryGuard).toHaveBeenCalledWith("SELECT 1", { source: "pool" });
  });
});
