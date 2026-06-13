import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dbQuery: vi.fn()
}));

vi.mock("@/server/db", () => ({
  db: {
    query: mocks.dbQuery
  }
}));

const ORIGINAL_ENV = { ...process.env };
const TENANT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SECOND_TENANT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe("tenant public ingress origin resolution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...ORIGINAL_ENV, NODE_ENV: "test" };
    mocks.dbQuery.mockResolvedValue({ rows: [] });
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("normalizes origin keys to scheme and host", async () => {
    const { normalizePublicIngressOriginKey } = await import("@/server/tenant-public-ingress");

    expect(normalizePublicIngressOriginKey("https://Support.Example.test/path?q=1")).toBe(
      "https://support.example.test"
    );
    expect(normalizePublicIngressOriginKey("support.example.test/")).toBe("support.example.test");
  });

  it("resolves tenant scope from the emergency env origin map", async () => {
    const { tenantScopeFromPublicIngressRequest } = await import("@/server/tenant-public-ingress");
    process.env.TENANT_PUBLIC_INGRESS_ORIGINS_JSON = JSON.stringify({
      "https://support.example.test": { tenantId: TENANT_ID, workspaceKey: "primary" }
    });

    const scope = await tenantScopeFromPublicIngressRequest(
      new Request("https://6esk.example/api/portal/tickets", {
        headers: { origin: "https://support.example.test/form" }
      })
    );

    expect(scope).toEqual({ tenantId: TENANT_ID, workspaceKey: "primary" });
    expect(mocks.dbQuery).not.toHaveBeenCalled();
  });

  it("resolves tenant scope from active database origins", async () => {
    const { tenantScopeFromPublicIngressRequest } = await import("@/server/tenant-public-ingress");
    mocks.dbQuery.mockResolvedValueOnce({
      rows: [{ tenant_id: TENANT_ID, workspace_key: "primary" }]
    });

    const scope = await tenantScopeFromPublicIngressRequest(
      new Request("https://6esk.example/api/portal/tickets", {
        headers: { origin: "https://support.example.test" }
      })
    );

    expect(scope).toEqual({ tenantId: TENANT_ID, workspaceKey: "primary" });
    expect(mocks.dbQuery).toHaveBeenCalledWith(
      expect.stringContaining("FROM tenant_public_ingress_origins"),
      [expect.arrayContaining(["https://support.example.test"])]
    );
  });

  it("fails closed for untrusted origins in production", async () => {
    const { tenantScopeFromPublicIngressRequest, TenantPublicIngressError } = await import(
      "@/server/tenant-public-ingress"
    );
    process.env.NODE_ENV = "production";

    await expect(
      tenantScopeFromPublicIngressRequest(
        new Request("https://6esk.example/api/portal/tickets", {
          headers: { origin: "https://unknown.example.test" }
        })
      )
    ).rejects.toBeInstanceOf(TenantPublicIngressError);
  });

  it("rejects ambiguous origin matches", async () => {
    const { tenantScopeFromPublicIngressRequest } = await import("@/server/tenant-public-ingress");
    mocks.dbQuery.mockResolvedValueOnce({
      rows: [
        { tenant_id: TENANT_ID, workspace_key: "primary" },
        { tenant_id: SECOND_TENANT_ID, workspace_key: "primary" }
      ]
    });

    await expect(
      tenantScopeFromPublicIngressRequest(
        new Request("https://6esk.example/api/portal/tickets", {
          headers: { origin: "https://support.example.test" }
        })
      )
    ).rejects.toMatchObject({ code: "tenant_public_origin_ambiguous", status: 409 });
  });
});
