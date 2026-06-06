import { describe, expect, it, vi } from "vitest";
import {
  buildAuditDefinitions,
  parseArgs,
  runTenantIsolationAudit
} from "../scripts/tenant-isolation-audit.js";

const catalog = {
  tables: [
    { name: "tenants", columns: ["tenant_key", "name"] },
    { name: "workspaces", columns: ["tenant_key", "workspace_key", "name"] },
    { name: "users", columns: ["id", "tenant_key", "workspace_key", "email"] },
    { name: "tickets", columns: ["id", "tenant_key", "workspace_key", "assigned_user_id"] },
    { name: "agent_runs", columns: ["id", "tenant_key", "integration_id"] },
    { name: "agent_run_events", columns: ["id", "run_id", "event_type"] },
    { name: "voice_consent_events", columns: ["id", "customer_id", "identity_value"] }
  ],
  foreignKeys: [
    {
      constraintName: "tickets_assigned_user_id_fkey",
      childTable: "tickets",
      parentTable: "users",
      childColumns: ["assigned_user_id"],
      parentColumns: ["id"]
    },
    {
      constraintName: "agent_run_events_run_id_fkey",
      childTable: "agent_run_events",
      parentTable: "agent_runs",
      childColumns: ["run_id"],
      parentColumns: ["id"]
    }
  ]
};

describe("tenant isolation audit script", () => {
  it("parses launch-mode CLI options", () => {
    expect(parseArgs(["--mode=external_launch", "--sample-limit=3", "--include-passed", "--json"])).toMatchObject({
      mode: "external_launch",
      sampleLimit: 3,
      includePassed: true,
      json: true
    });
  });

  it("builds dynamic checks from catalog scope and foreign-key metadata", () => {
    const definitions = buildAuditDefinitions(catalog, { mode: "external_launch" });
    const keys = definitions.map((definition) => definition.key);

    expect(keys).toContain("users.missing_scope");
    expect(keys).toContain("users.orphan_workspace");
    expect(keys).toContain("tickets.assigned_user_id.cross_tenant_reference");
    expect(keys).toContain("agent_run_events.run_id.orphan_parent");
    expect(keys).toContain("agent_run_events.run_id.primary_bridge_parent");
    expect(keys).toContain("voice_consent_events.unscoped_identity_without_customer");
    expect(definitions.find((definition) => definition.key === "tenants.primary_bridge")).toMatchObject({
      severity: "blocker"
    });
  });

  it("runs the database audit and returns blocker evidence", async () => {
    const client = {
      query: vi.fn((query: string) => {
        if (query.includes("information_schema.tables")) {
          return Promise.resolve({ rows: catalog.tables.map((table) => ({ table_name: table.name })) });
        }
        if (query.includes("information_schema.columns")) {
          return Promise.resolve({
            rows: catalog.tables.flatMap((table) =>
              table.columns.map((column) => ({ table_name: table.name, column_name: column }))
            )
          });
        }
        if (query.includes("pg_constraint")) {
          return Promise.resolve({
            rows: catalog.foreignKeys.map((foreignKey) => ({
              constraint_name: foreignKey.constraintName,
              child_table: foreignKey.childTable,
              parent_table: foreignKey.parentTable,
              child_columns: foreignKey.childColumns,
              parent_columns: foreignKey.parentColumns
            }))
          });
        }
        if (
          query.includes("COUNT(*)") &&
          query.includes('FROM "users" WHERE') &&
          query.includes('"tenant_key" IS NULL')
        ) {
          return Promise.resolve({ rows: [{ count: "1" }] });
        }
        if (
          !query.includes("COUNT(*)") &&
          query.includes('FROM "users" WHERE') &&
          query.includes('"tenant_key" IS NULL')
        ) {
          return Promise.resolve({ rows: [{ sample_id: "user-1" }] });
        }
        if (query.includes("COUNT(*)")) {
          return Promise.resolve({ rows: [{ count: "0" }] });
        }
        return Promise.resolve({ rows: [] });
      })
    };

    const report = await runTenantIsolationAudit(client, { mode: "external_launch", sampleLimit: 1 });

    expect(report.ready).toBe(false);
    expect(report.blockerCount).toBe(1);
    expect(report.summary.missingScopeRows).toBe(1);
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        key: "users.missing_scope",
        severity: "blocker",
        count: 1,
        sampleIds: ["user-1"]
      })
    );
  });
});
