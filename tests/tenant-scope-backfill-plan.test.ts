import { describe, expect, it, vi } from "vitest";
import {
  buildBackfillDefinitions,
  parseArgs,
  runTenantScopeBackfillPlan
} from "../scripts/tenant-scope-backfill-plan.js";

const catalog = {
  tables: [
    { name: "tenants", columns: ["tenant_key", "name"] },
    { name: "workspaces", columns: ["tenant_key", "workspace_key", "name"] },
    { name: "users", columns: ["id", "tenant_key", "workspace_key", "email"] },
    { name: "agent_integrations", columns: ["id", "tenant_key", "name"] }
  ]
};

describe("tenant scope backfill plan", () => {
  it("parses target scope and evidence options", () => {
    expect(
      parseArgs([
        "--source-tenant=primary",
        "--source-workspace=primary",
        "--target-tenant=tenant-a",
        "--target-workspace=workspace-a",
        "--sample-limit=3",
        "--include-empty",
        "--evidence-dir=.launch-evidence/tenant-backfill",
        "--json"
      ])
    ).toMatchObject({
      sourceTenant: "primary",
      sourceWorkspace: "primary",
      targetTenant: "tenant-a",
      targetWorkspace: "workspace-a",
      sampleLimit: 3,
      includeEmpty: true,
      evidenceDir: ".launch-evidence/tenant-backfill",
      json: true
    });
  });

  it("builds table-level reassignment previews without writes", () => {
    const definitions = buildBackfillDefinitions(catalog);

    expect(definitions).toContainEqual(
      expect.objectContaining({
        tableName: "tenants",
        rootTable: true,
        operation: "manual_root_tenant"
      })
    );
    expect(definitions).toContainEqual(
      expect.objectContaining({
        tableName: "users",
        rootTable: false,
        scopeType: "workspace",
        operation: "workspace_scope_reassignment",
        updatePreview:
          'UPDATE "users" SET tenant_key = :targetTenant, workspace_key = :targetWorkspace WHERE tenant_key = :sourceTenant AND workspace_key = :sourceWorkspace;'
      })
    );
    expect(definitions).toContainEqual(
      expect.objectContaining({
        tableName: "agent_integrations",
        rootTable: false,
        scopeType: "tenant",
        operation: "tenant_scope_reassignment",
        updatePreview:
          'UPDATE "agent_integrations" SET tenant_key = :targetTenant WHERE tenant_key = :sourceTenant;'
      })
    );
  });

  it("classifies source-scope rows and marks missing targets as blockers", async () => {
    const client = {
      query: vi.fn((sql: string, params: unknown[] = []) => {
        if (sql.includes("information_schema.tables")) {
          return Promise.resolve({ rows: catalog.tables.map((table) => ({ table_name: table.name })) });
        }
        if (sql.includes("information_schema.columns")) {
          return Promise.resolve({
            rows: catalog.tables.flatMap((table) =>
              table.columns.map((column) => ({ table_name: table.name, column_name: column }))
            )
          });
        }
        if (sql.includes('FROM "tenants"') && sql.includes("COUNT(*)")) {
          return Promise.resolve({ rows: [{ count: params[0] === "missing-tenant" ? "0" : "1" }] });
        }
        if (sql.includes('FROM "workspaces"') && sql.includes("COUNT(*)")) {
          return Promise.resolve({ rows: [{ count: params[0] === "missing-tenant" ? "0" : "1" }] });
        }
        if (sql.includes('FROM "users"') && sql.includes("COUNT(*)")) {
          return Promise.resolve({ rows: [{ count: "2" }] });
        }
        if (sql.includes('FROM "agent_integrations"') && sql.includes("COUNT(*)")) {
          return Promise.resolve({ rows: [{ count: "1" }] });
        }
        if (sql.includes('FROM "users"')) {
          return Promise.resolve({ rows: [{ sample_id: "user-1" }, { sample_id: "user-2" }] });
        }
        if (sql.includes('FROM "agent_integrations"')) {
          return Promise.resolve({ rows: [{ sample_id: "agent-1" }] });
        }
        return Promise.resolve({ rows: [{ sample_id: "primary" }] });
      })
    };

    const report = await runTenantScopeBackfillPlan(client, {
      sourceTenant: "primary",
      sourceWorkspace: "primary",
      targetTenant: "missing-tenant",
      targetWorkspace: "workspace-a",
      sampleLimit: 2
    });

    expect(report.writesDatabase).toBe(false);
    expect(report.readyToApply).toBe(false);
    expect(report.readinessReasons).toContain("target tenant does not exist");
    expect(report.readinessReasons).toContain("target workspace does not exist");
    expect(report.summary.impactedRowCount).toBe(5);
    expect(report.summary.impactedTableCount).toBe(4);
    expect(report.tables).toContainEqual(
      expect.objectContaining({
        tableName: "users",
        rowCount: 2,
        sampleIds: ["user-1", "user-2"]
      })
    );
  });
});
