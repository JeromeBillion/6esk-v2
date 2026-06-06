import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import {
  parseArgs,
  runTenantQueryScopeSweep,
  scanFileContent,
  writeSweepEvidence
} from "../scripts/tenant-query-scope-sweep.js";

describe("tenant query scope sweep", () => {
  it("parses evidence and root options", () => {
    expect(
      parseArgs([
        "--root=src/server",
        "--root=scripts",
        "--max-findings=25",
        "--include-passed",
        "--evidence-dir=.launch-evidence/tenant-query-scope",
        "--fail-on=never",
        "--json"
      ])
    ).toMatchObject({
      roots: ["src/server", "scripts"],
      maxFindings: 25,
      includePassed: true,
      evidenceDir: ".launch-evidence/tenant-query-scope",
      failOn: "never",
      json: true
    });
  });

  it("flags scoped table queries without tenant_key evidence", () => {
    const result = scanFileContent(
      "src/server/bad.ts",
      `
      export async function loadTicket(id: string) {
        return db.query("SELECT id FROM tickets WHERE id = $1", [id]);
      }
      `
    );

    expect(result.findings).toContainEqual(
      expect.objectContaining({
        severity: "blocker",
        table: "tickets",
        check: "missing_tenant_scope_predicate"
      })
    );
  });

  it("passes queries that include tenant_key evidence", () => {
    const result = scanFileContent(
      "src/server/good.ts",
      `
      export async function loadTicket(id: string, tenantKey: string) {
        return db.query("SELECT id FROM tickets WHERE id = $1 AND tenant_key = $2", [id, tenantKey]);
      }
      `,
      { includePassed: true }
    );

    expect(result.findings).toHaveLength(0);
    expect(result.passed).toContainEqual(
      expect.objectContaining({
        file: "src/server/good.ts",
        tables: ["tickets"]
      })
    );
  });

  it("scans auth and tenant security policy tables", () => {
    const result = scanFileContent(
      "src/server/auth-gaps.ts",
      `
      await db.query("SELECT id FROM auth_identity_accounts WHERE user_id = $1", [userId]);
      await db.query("SELECT workspace_key FROM tenant_security_policies WHERE workspace_key = $1", [workspaceKey]);
      `
    );

    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          table: "auth_identity_accounts",
          check: "missing_tenant_scope_predicate"
        }),
        expect.objectContaining({
          table: "tenant_security_policies",
          check: "missing_tenant_scope_predicate"
        })
      ])
    );
  });

  it("scans billing lifecycle tables", () => {
    const result = scanFileContent(
      "src/server/billing-gap.ts",
      `
      await db.query("SELECT id FROM workspace_billing_invoices WHERE id = $1", [invoiceId]);
      await db.query("SELECT id FROM workspace_billing_subscriptions WHERE tenant_key = $1", [tenantKey]);
      `
    );

    expect(result.findings).toEqual([
      expect.objectContaining({
        table: "workspace_billing_invoices",
        check: "missing_tenant_scope_predicate"
      })
    ]);
  });

  it("allows intentional global reads with a suppression comment", () => {
    const result = scanFileContent(
      "src/server/global-admin.ts",
      `
      // tenant-scope-sweep: ignore lead-admin cross-tenant inventory
      await db.query("SELECT id FROM users WHERE id = $1", [userId]);
      `
    );

    expect(result.findings).toHaveLength(0);
    expect(result.suppressed).toContainEqual(
      expect.objectContaining({
        reason: "suppression_comment",
        tables: ["users"]
      })
    );
  });

  it("scans roots and writes read-only evidence", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "tenant-query-scope-"));
    const sourceDir = path.join(root, "src", "server");
    const outputPath = path.join(root, "evidence", "sweep.json");
    fs.mkdirSync(sourceDir, { recursive: true });
    fs.writeFileSync(
      path.join(sourceDir, "queries.ts"),
      `
      await db.query("SELECT id FROM tickets WHERE tenant_key = $1", [tenantKey]);
      await db.query("SELECT id FROM messages WHERE id = $1", [messageId]);
      `,
      "utf8"
    );

    try {
      const report = await runTenantQueryScopeSweep({
        cwd: root,
        roots: ["src/server"],
        maxFindings: 10,
        includePassed: true
      });
      await writeSweepEvidence(report, outputPath);

      expect(report.ready).toBe(false);
      expect(report.writesDatabase).toBe(false);
      expect(report.staticAnalysisOnly).toBe(true);
      expect(report.summary.fileCount).toBe(1);
      expect(report.summary.blockerCount).toBe(1);
      expect(report.findings[0]).toMatchObject({
        file: "src/server/queries.ts",
        table: "messages"
      });
      expect(JSON.parse(fs.readFileSync(outputPath, "utf8"))).toMatchObject({
        formatVersion: "tenant-query-scope-sweep.v1",
        writesDatabase: false
      });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
