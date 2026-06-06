import { describe, expect, it, vi } from "vitest";
import {
  parseReconcileScope,
  reconcileTicket
} from "../scripts/reconcile-ticket-customers.js";

describe("reconcile ticket customers script", () => {
  it("requires explicit tenant scope in production", () => {
    expect(() => parseReconcileScope({ NODE_ENV: "production" })).toThrow(
      /CUSTOMER_RECONCILE_TENANT_KEY/
    );
    expect(
      parseReconcileScope({
        NODE_ENV: "production",
        CUSTOMER_RECONCILE_TENANT_KEY: "tenant-a",
        CUSTOMER_RECONCILE_WORKSPACE_KEY: "workspace-a"
      })
    ).toEqual({ tenantKey: "tenant-a", workspaceKey: "workspace-a" });
  });

  it("uses tenant scope for lookup and ticket writes", async () => {
    const queries: Array<{ sql: string; values: unknown[] }> = [];
    const client = {
      query: vi.fn((sql: string, values: unknown[]) => {
        queries.push({ sql, values });
        if (sql.includes("FROM customer_identities")) {
          return Promise.resolve({ rows: [{ id: "customer-1" }] });
        }
        return Promise.resolve({ rows: [] });
      })
    };

    await reconcileTicket(
      client,
      {
        id: "ticket-1",
        requester_email: "Customer@Example.test",
        metadata: {}
      },
      false,
      {
        tenantKey: "tenant-a",
        workspaceKey: "workspace-a"
      }
    );

    expect(queries.some((query) => query.sql.includes("ci.tenant_key = $1"))).toBe(true);
    expect(queries.some((query) => query.sql.includes("c.tenant_key = $1"))).toBe(true);
    expect(queries.some((query) => query.sql.includes("AND tenant_key = $3"))).toBe(true);
    expect(queries.some((query) => query.sql.includes("AND workspace_key = $4"))).toBe(true);
    expect(queries.every((query) => query.values.includes("tenant-a"))).toBe(true);
  });
});
