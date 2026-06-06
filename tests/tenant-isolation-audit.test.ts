import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dbQuery: vi.fn()
}));

vi.mock("@/server/db", () => ({
  db: {
    query: mocks.dbQuery
  }
}));

import { runTenantIsolationAudit } from "@/server/tenant-isolation-audit";

describe("tenant isolation audit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.dbQuery.mockImplementation((query: string) => {
      if (query.includes("COUNT(*)")) {
        return Promise.resolve({ rows: [{ count: "0" }] });
      }
      return Promise.resolve({ rows: [] });
    });
  });

  it("returns a ready report when all checks pass", async () => {
    const report = await runTenantIsolationAudit();

    expect(report).toMatchObject({
      formatVersion: "tenant-isolation-audit.v1",
      mode: "standard",
      ready: true,
      blockerCount: 0,
      warningCount: 0,
      failedCheckCount: 0,
      checks: []
    });
    expect(report.evaluatedCheckCount).toBeGreaterThan(50);
    expect(report.summary).toMatchObject({
      missingScopeRows: 0,
      orphanWorkspaceRows: 0,
      primaryBridgeRows: 0
    });
  });

  it("flags tenantless workspace rows as launch blockers with samples", async () => {
    mocks.dbQuery.mockImplementation((query: string) => {
      if (
        query.includes("COUNT(*)") &&
        query.includes("FROM users WHERE") &&
        query.includes("tenant_key IS NULL")
      ) {
        return Promise.resolve({ rows: [{ count: "2" }] });
      }
      if (
        !query.includes("COUNT(*)") &&
        query.includes("FROM users WHERE") &&
        query.includes("tenant_key IS NULL")
      ) {
        return Promise.resolve({ rows: [{ sample_id: "user-1" }, { sample_id: "user-2" }] });
      }
      if (query.includes("COUNT(*)")) {
        return Promise.resolve({ rows: [{ count: "0" }] });
      }
      return Promise.resolve({ rows: [] });
    });

    const report = await runTenantIsolationAudit({ sampleLimit: 2 });

    expect(report.ready).toBe(false);
    expect(report.blockerCount).toBe(1);
    expect(report.summary.missingScopeRows).toBe(2);
    expect(report.checks).toEqual([
      expect.objectContaining({
        key: "users.missing_scope",
        tableName: "users",
        check: "missing_scope",
        severity: "blocker",
        count: 2,
        sampleIds: ["user-1", "user-2"]
      })
    ]);
    const sampleCall = mocks.dbQuery.mock.calls.find(([query]) =>
      String(query).includes("FROM users WHERE") && !String(query).includes("COUNT(*)")
    );
    expect(sampleCall?.[1]).toEqual([2]);
  });

  it("treats legacy primary rows as blockers in external launch mode", async () => {
    mocks.dbQuery.mockImplementation((query: string) => {
      if (query.includes("COUNT(*)") && query.includes("FROM tenants WHERE tenant_key = 'primary'")) {
        return Promise.resolve({ rows: [{ count: "1" }] });
      }
      if (!query.includes("COUNT(*)") && query.includes("FROM tenants WHERE tenant_key = 'primary'")) {
        return Promise.resolve({ rows: [{ sample_id: "primary" }] });
      }
      if (query.includes("COUNT(*)")) {
        return Promise.resolve({ rows: [{ count: "0" }] });
      }
      return Promise.resolve({ rows: [] });
    });

    const standard = await runTenantIsolationAudit({ mode: "standard" });
    const externalLaunch = await runTenantIsolationAudit({ mode: "external_launch" });

    expect(standard.ready).toBe(true);
    expect(standard.warningCount).toBe(1);
    expect(externalLaunch.ready).toBe(false);
    expect(externalLaunch.blockerCount).toBe(1);
    expect(externalLaunch.checks[0]).toMatchObject({
      key: "tenants.primary_bridge",
      severity: "blocker",
      sampleIds: ["primary"]
    });
  });

  it("turns audit query failures into blocker evidence gaps", async () => {
    mocks.dbQuery.mockImplementation((query: string) => {
      if (query.includes("FROM workspace_modules")) {
        throw new Error("relation does not exist");
      }
      if (query.includes("COUNT(*)")) {
        return Promise.resolve({ rows: [{ count: "0" }] });
      }
      return Promise.resolve({ rows: [] });
    });

    const report = await runTenantIsolationAudit();

    expect(report.ready).toBe(false);
    expect(report.blockerCount).toBeGreaterThan(0);
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        key: "workspace_modules.missing_scope",
        severity: "blocker",
        count: 1,
        error: "relation does not exist"
      })
    );
  });
});
