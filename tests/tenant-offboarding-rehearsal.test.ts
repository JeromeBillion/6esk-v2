import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it, vi } from "vitest";
import {
  parseArgs,
  runTenantOffboardingRehearsal,
  TENANT_TABLES,
  WORKSPACE_TABLES,
  writeRehearsalEvidence
} from "../scripts/tenant-offboarding-rehearsal.js";

function buildCatalogRows() {
  const tableNames = [...TENANT_TABLES, ...WORKSPACE_TABLES, "better_auth_users"];
  const tableRows = tableNames.map((table_name) => ({ table_name }));
  const columnRows = tableNames.flatMap((table_name) => {
    const columns =
      table_name === "tenants"
        ? ["tenant_key", "name", "status"]
        : table_name === "organizations"
          ? ["tenant_key", "organization_key", "name", "status"]
          : table_name === "better_auth_users"
            ? ["id", "email"]
            : ["id", "tenant_key", "workspace_key"];
    const extraColumns =
      table_name === "messages"
        ? ["r2_key_raw", "r2_key_html", "r2_key_text"]
        : table_name === "attachments"
          ? ["r2_key"]
          : table_name === "call_sessions"
            ? ["recording_r2_key", "transcript_r2_key"]
            : table_name === "ai_knowledge_quarantine_events"
              ? ["storage_key"]
              : table_name === "ai_knowledge_documents"
                ? ["metadata"]
                : [];
    return [...columns, ...extraColumns].map((column_name) => ({ table_name, column_name }));
  });
  return { tableRows, columnRows };
}

function buildClient({
  legalHoldCount = "0",
  objectRefCount = "0",
  betterAuthRows = "0",
  tableRows = "1"
}: {
  legalHoldCount?: string;
  objectRefCount?: string;
  betterAuthRows?: string;
  tableRows?: string;
} = {}) {
  const catalog = buildCatalogRows();
  return {
    query: vi.fn((sql: string) => {
      if (sql.includes("information_schema.tables")) {
        return Promise.resolve({ rows: catalog.tableRows });
      }
      if (sql.includes("information_schema.columns")) {
        return Promise.resolve({ rows: catalog.columnRows });
      }
      if (sql.includes("FROM tenants WHERE tenant_key")) {
        return Promise.resolve({ rows: [{ count: "1" }] });
      }
      if (sql.includes("FROM workspaces WHERE tenant_key")) {
        return Promise.resolve({ rows: [{ count: "1" }] });
      }
      if (sql.includes("COALESCE(metadata #>> '{retention,legalHold}'")) {
        return Promise.resolve({ rows: [{ count: legalHoldCount }] });
      }
      if (sql.includes("FROM better_auth_users")) {
        return Promise.resolve({ rows: [{ count: betterAuthRows }] });
      }
      if (
        sql.includes("r2_key") ||
        sql.includes("recording_r2_key") ||
        sql.includes("transcript_r2_key") ||
        sql.includes("storage_key")
      ) {
        return Promise.resolve({ rows: [{ count: objectRefCount }] });
      }
      return Promise.resolve({ rows: [{ count: tableRows }] });
    })
  };
}

describe("tenant offboarding rehearsal script", () => {
  it("parses scoped rehearsal options", () => {
    expect(
      parseArgs([
        "--tenant=tenant-a",
        "--workspace=workspace-a",
        "--mode=delete",
        "--include-passed",
        "--evidence-dir=.launch-evidence/tenant-offboarding",
        "--json"
      ])
    ).toMatchObject({
      tenantKey: "tenant-a",
      workspaceKey: "workspace-a",
      mode: "delete",
      includePassed: true,
      evidenceDir: ".launch-evidence/tenant-offboarding",
      json: true
    });
  });

  it("rejects missing target scope", () => {
    expect(() => parseArgs(["--tenant=tenant-a"])).toThrow(/--workspace is required/);
  });

  it("builds read-only evidence with object-reference warnings", async () => {
    const client = buildClient({ objectRefCount: "2", betterAuthRows: "3" });
    const report = await runTenantOffboardingRehearsal(client, {
      tenantKey: "tenant-a",
      workspaceKey: "workspace-a",
      mode: "anonymize",
      includePassed: false
    });

    expect(report.writesDatabase).toBe(false);
    expect(report.secretsRedacted).toBe(true);
    expect(report.ready).toBe(true);
    expect(report.summary.objectReferenceRows).toBeGreaterThan(0);
    expect(report.warningCount).toBeGreaterThan(0);
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        check: "object_reference",
        severity: "warning",
        count: 2
      })
    );
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        key: "better_auth_adapter.global_tables",
        severity: "warning",
        count: 3
      })
    );
  });

  it("blocks legal holds and physical delete rehearsals", async () => {
    const client = buildClient({ legalHoldCount: "1" });
    const report = await runTenantOffboardingRehearsal(client, {
      tenantKey: "tenant-a",
      workspaceKey: "workspace-a",
      mode: "delete",
      includePassed: false
    });

    expect(report.ready).toBe(false);
    expect(report.blockerCount).toBe(2);
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "legal_hold.knowledge_documents", count: 1 }),
        expect.objectContaining({ key: "physical_delete.preview_only", count: 1 })
      ])
    );
  });

  it("writes redacted rehearsal evidence", async () => {
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "tenant-offboarding-rehearsal-"));
    const outputPath = path.join(outputDir, "evidence.json");

    try {
      await writeRehearsalEvidence(
        {
          formatVersion: "tenant-offboarding-rehearsal.v1",
          reportId: "report-1",
          writesDatabase: false,
          secretsRedacted: true
        },
        outputPath
      );

      expect(JSON.parse(fs.readFileSync(outputPath, "utf8"))).toMatchObject({
        formatVersion: "tenant-offboarding-rehearsal.v1",
        writesDatabase: false,
        secretsRedacted: true
      });
    } finally {
      fs.rmSync(outputDir, { recursive: true, force: true });
    }
  });
});
