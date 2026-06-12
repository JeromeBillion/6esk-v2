import { Pool } from "pg";
import { enforceTenantQueryGuard } from "@/server/tenant-query-guard";

type GuardedQueryTarget = {
  query: (...args: never[]) => unknown;
  __tenantQueryGuardWrapped?: boolean;
};

type GuardedPool = Pool & {
  __tenantQueryGuardWrapped?: boolean;
  __tenantQueryGuardConnectWrapped?: boolean;
};

const globalForDb = globalThis as unknown as { pool?: GuardedPool };

function wrapQueryTarget<T extends GuardedQueryTarget>(target: T, source: string) {
  if (target.__tenantQueryGuardWrapped) return target;
  const originalQuery = target.query.bind(target);
  target.query = ((queryTextOrConfig: unknown, ...args: never[]) => {
    enforceTenantQueryGuard(queryTextOrConfig, { source });
    return originalQuery(queryTextOrConfig as never, ...args);
  }) as T["query"];
  target.__tenantQueryGuardWrapped = true;
  return target;
}

function wrapPool(pool: GuardedPool) {
  wrapQueryTarget(pool as unknown as GuardedQueryTarget, "pool");
  if (!pool.__tenantQueryGuardConnectWrapped) {
    const originalConnect = pool.connect.bind(pool);
    pool.connect = (async () => {
      const client = await originalConnect();
      return wrapQueryTarget(client as unknown as GuardedQueryTarget, "client");
    }) as typeof pool.connect;
    pool.__tenantQueryGuardConnectWrapped = true;
  }
  return pool;
}

export const db = wrapPool(
  globalForDb.pool ??
    new Pool({
      connectionString: process.env.DATABASE_URL,
      max: parseInt(process.env.DB_POOL_MAX ?? "20", 10),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      statement_timeout: 30_000
    })
);

if (process.env.NODE_ENV !== "production") {
  globalForDb.pool = db as GuardedPool;
}
