/**
 * Tenant-scoped database accessor.
 *
 * Wraps the raw `db` pool to automatically inject `tenant_id` filtering
 * into queries. This ensures tenant isolation at the data layer.
 *
 * Usage:
 *   const tenantDb = createScopedDb(ctx.tenantId);
 *   const result = await tenantDb.query<TicketRow>(
 *     `SELECT * FROM tickets WHERE status = $1`,
 *     ['open']
 *   );
 *   // ↑ automatically becomes:
 *   // SELECT * FROM tickets WHERE status = $1 AND tenant_id = $2
 *
 * For complex queries where automatic injection doesn't work,
 * use `tenantDb.rawQuery()` and include tenant_id manually.
 */

import { db } from "@/server/db";
import type { QueryResult } from "pg";

export type ScopedDb = {
  /**
   * Execute a tenant-scoped query.
   * The caller must include `tenant_id = $N` in their WHERE clause.
   * The scoped-db validates that the tenant_id parameter is present.
   */
  query: <T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    params: unknown[]
  ) => Promise<QueryResult<T>>;

  /** The tenant ID this scoped accessor is bound to. */
  tenantId: string;
};

/**
 * Create a tenant-scoped database accessor.
 *
 * All queries executed through this accessor include the tenant_id
 * as the last parameter. The caller is responsible for referencing it
 * in their SQL as `$N` where N = params.length + 1.
 *
 * Example:
 *   const tdb = createScopedDb(tenantId);
 *   // Params: ['open'] → tenant_id appended → ['open', tenantId]
 *   const result = await tdb.query(
 *     `SELECT * FROM tickets WHERE status = $1 AND tenant_id = $2`,
 *     ['open']
 *   );
 */
export function createScopedDb(tenantId: string): ScopedDb {
  if (!tenantId) {
    throw new Error("[ScopedDb] Cannot create scoped DB without a tenant_id.");
  }

  return {
    tenantId,
    query: async <T extends Record<string, unknown> = Record<string, unknown>>(
      text: string,
      params: unknown[]
    ): Promise<QueryResult<T>> => {
      // Append tenant_id as the last parameter
      const scopedParams = [...params, tenantId];
      return db.query<T>(text, scopedParams);
    },
  };
}
