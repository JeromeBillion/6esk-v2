import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dbQuery: vi.fn(),
  dbConnect: vi.fn(),
  clientQuery: vi.fn(),
  clientRelease: vi.fn()
}));

vi.mock("@/server/db", () => ({
  db: {
    query: mocks.dbQuery,
    connect: mocks.dbConnect
  }
}));

import {
  executeTenantOffboardingAnonymization,
  previewTenantOffboarding,
  TenantOffboardingError
} from "@/server/tenant-offboarding";

describe("tenant offboarding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.dbQuery.mockImplementation((query: string) => {
      if (query.includes("COALESCE(metadata #>> '{retention,legalHold}'")) {
        return Promise.resolve({ rows: [{ count: "0" }] });
      }
      if (query.includes("FROM users")) {
        return Promise.resolve({ rows: [{ count: "2" }] });
      }
      if (query.includes("FROM auth_sessions")) {
        return Promise.resolve({ rows: [{ count: "1" }] });
      }
      return Promise.resolve({ rows: [{ count: "0" }] });
    });
    mocks.clientQuery.mockImplementation((query: string) => {
      if (query === "BEGIN" || query === "COMMIT" || query === "ROLLBACK") {
        return Promise.resolve({ rows: [] });
      }
      if (query.includes("INSERT INTO audit_logs")) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [{ count: "1" }] });
    });
    mocks.dbConnect.mockResolvedValue({
      query: mocks.clientQuery,
      release: mocks.clientRelease
    });
  });

  it("previews tenant-scoped row counts and required confirmation", async () => {
    const report = await previewTenantOffboarding({
      tenantKey: "tenant-a",
      workspaceKey: "workspace-a"
    });

    expect(report).toMatchObject({
      formatVersion: "tenant-offboarding.v1",
      tenantKey: "tenant-a",
      workspaceKey: "workspace-a",
      mode: "anonymize",
      dryRun: true,
      confirmationRequired: "ANONYMIZE tenant-a/workspace-a"
    });
    expect(report.tables.find((table) => table.source === "users")).toMatchObject({
      rowCount: 2,
      plannedAction: "anonymize"
    });
    expect(report.tables.find((table) => table.source === "auth_sessions")).toMatchObject({
      rowCount: 1,
      plannedAction: "delete_ephemeral"
    });
    const authSessionsCount = mocks.dbQuery.mock.calls.find(([query]) =>
      String(query).includes("FROM auth_sessions")
    );
    expect(authSessionsCount?.[1]).toEqual(["tenant-a", "workspace-a"]);
  });

  it("executes anonymization in one transaction with an audit event", async () => {
    const report = await executeTenantOffboardingAnonymization({
      scope: { tenantKey: "tenant-a", workspaceKey: "workspace-a" },
      confirmation: "ANONYMIZE tenant-a/workspace-a",
      reason: "Customer requested contractual offboarding",
      actorUserId: "user-1",
      accessMode: "tenant_admin"
    });

    expect(report.dryRun).toBe(false);
    expect(report.mutations.length).toBeGreaterThan(10);
    expect(mocks.clientQuery).toHaveBeenCalledWith("BEGIN");
    expect(mocks.clientQuery).toHaveBeenCalledWith("COMMIT");
    expect(mocks.clientQuery).not.toHaveBeenCalledWith("ROLLBACK");
    expect(
      mocks.clientQuery.mock.calls.some(([query]) => String(query).includes("DELETE FROM auth_sessions"))
    ).toBe(true);
    expect(mocks.clientQuery.mock.calls.some(([query]) => String(query).includes("UPDATE users"))).toBe(true);
    expect(
      mocks.clientQuery.mock.calls.some(([, params]) =>
        Array.isArray(params) && params.includes("tenant_offboarding_anonymization_executed")
      )
    ).toBe(true);
    expect(mocks.clientRelease).toHaveBeenCalled();
  });

  it("blocks execution while tenant knowledge is under legal hold", async () => {
    mocks.dbQuery.mockImplementation((query: string) => {
      if (query.includes("COALESCE(metadata #>> '{retention,legalHold}'")) {
        return Promise.resolve({ rows: [{ count: "1" }] });
      }
      return Promise.resolve({ rows: [{ count: "0" }] });
    });

    await expect(
      executeTenantOffboardingAnonymization({
        scope: { tenantKey: "tenant-a", workspaceKey: "workspace-a" },
        confirmation: "ANONYMIZE tenant-a/workspace-a",
        reason: "Customer requested contractual offboarding",
        actorUserId: "user-1",
        accessMode: "tenant_admin"
      })
    ).rejects.toMatchObject({
      name: "TenantOffboardingError",
      code: "offboarding_blocked"
    } satisfies Partial<TenantOffboardingError>);
    expect(mocks.dbConnect).not.toHaveBeenCalled();
  });
});
