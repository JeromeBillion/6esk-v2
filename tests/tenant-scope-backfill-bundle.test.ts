import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import {
  buildMigrationBundle,
  parseArgs,
  validatePlan,
  writeMigrationBundle
} from "../scripts/tenant-scope-backfill-bundle.js";

const readyPlan = {
  formatVersion: "tenant-scope-backfill-plan.v1",
  reportId: "plan-1",
  generatedAt: "2026-05-31T20:00:00.000Z",
  mode: "dry_run",
  readyToApply: true,
  source: {
    tenantKey: "primary",
    workspaceKey: "primary"
  },
  target: {
    tenantKey: "tenant-a",
    workspaceKey: "workspace-a"
  },
  scopeState: {
    sourceTenantExists: true,
    sourceWorkspaceExists: true,
    targetTenantExists: true,
    targetWorkspaceExists: true
  },
  sampleLimit: 2,
  summary: {
    scopedTableCount: 4,
    impactedTableCount: 3,
    impactedRowCount: 4,
    rootTableRowCount: 1,
    tenantScopedRowCount: 1,
    workspaceScopedRowCount: 2,
    targetConflictTableCount: 0,
    targetConflictRowCount: 0,
    errorTableCount: 0
  },
  readinessReasons: [],
  writesDatabase: false,
  tables: [
    {
      tableName: "tenants",
      scopeType: "tenant",
      operation: "manual_root_tenant",
      rootTable: true,
      rowCount: 1,
      targetRowCount: 1,
      sampleIds: ["primary"],
      updatePreview: "Create the target tenant before child-row reassignment."
    },
    {
      tableName: "users",
      scopeType: "workspace",
      operation: "workspace_scope_reassignment",
      rootTable: false,
      rowCount: 2,
      targetRowCount: 0,
      sampleIds: ["user-1", "user-2"],
      updatePreview:
        'UPDATE "users" SET tenant_key = :targetTenant, workspace_key = :targetWorkspace WHERE tenant_key = :sourceTenant AND workspace_key = :sourceWorkspace;'
    },
    {
      tableName: "agent_integrations",
      scopeType: "tenant",
      operation: "tenant_scope_reassignment",
      rootTable: false,
      rowCount: 1,
      targetRowCount: 0,
      sampleIds: ["agent-1"],
      updatePreview:
        'UPDATE "agent_integrations" SET tenant_key = :targetTenant WHERE tenant_key = :sourceTenant;'
    }
  ]
};

describe("tenant scope backfill bundle", () => {
  it("parses plan and output directory options", () => {
    expect(parseArgs(["--plan=plan.json", "--bundle-dir=.launch-evidence/bundles"])).toMatchObject({
      plan: "plan.json",
      bundleDir: ".launch-evidence/bundles"
    });
  });

  it("generates reviewed apply and rollback SQL without executing writes", () => {
    const bundle = buildMigrationBundle(readyPlan, {
      bundleId: "bundle-1",
      generatedAt: "2026-05-31T21:00:00.000Z"
    });

    expect(bundle.manifest).toMatchObject({
      formatVersion: "tenant-scope-backfill-bundle.v1",
      bundleId: "bundle-1",
      planReportId: "plan-1",
      migrationTableCount: 2,
      migrationRowCount: 3,
      writesDatabase: false
    });
    expect(bundle.manifest.rootManualTables).toEqual([
      { tableName: "tenants", rowCount: 1, operation: "manual_root_tenant" }
    ]);
    expect(bundle.applySql).toContain('UPDATE "users"');
    expect(bundle.applySql).toContain('"tenant_key" = \'tenant-a\', "workspace_key" = \'workspace-a\'');
    expect(bundle.applySql).toContain("target scope is not empty");
    expect(bundle.rollbackSql).toContain('UPDATE "users"');
    expect(bundle.rollbackSql).toContain('"tenant_key" = \'primary\', "workspace_key" = \'primary\'');
    expect(bundle.rollbackSql).toContain("target row count changed");
  });

  it("blocks bundle generation when rollback would be ambiguous", () => {
    const conflictedPlan = {
      ...readyPlan,
      readyToApply: false,
      readinessReasons: [
        "target scope already contains child rows; reversible bundle generation requires an empty target child scope"
      ],
      tables: readyPlan.tables.map((table) =>
        table.tableName === "users" ? { ...table, targetRowCount: 1 } : table
      )
    };

    expect(validatePlan(conflictedPlan)).toContain(
      "plan must be readyToApply=true before bundle generation"
    );
    expect(() => buildMigrationBundle(conflictedPlan)).toThrow(/rollback would be ambiguous/);
  });

  it("writes manifest, apply, rollback, and readme files", async () => {
    const bundle = buildMigrationBundle(readyPlan, {
      bundleId: "bundle-write-test",
      generatedAt: "2026-05-31T21:00:00.000Z"
    });
    const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tenant-backfill-bundle-"));

    try {
      const outputDir = await writeMigrationBundle(bundle, outputRoot);

      expect(fs.existsSync(path.join(outputDir, "manifest.json"))).toBe(true);
      expect(fs.existsSync(path.join(outputDir, "apply.sql"))).toBe(true);
      expect(fs.existsSync(path.join(outputDir, "rollback.sql"))).toBe(true);
      expect(fs.existsSync(path.join(outputDir, "README.md"))).toBe(true);
    } finally {
      fs.rmSync(outputRoot, { recursive: true, force: true });
    }
  });
});
