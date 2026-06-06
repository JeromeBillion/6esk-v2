import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dbQuery: vi.fn()
}));

vi.mock("@/server/db", () => ({
  db: {
    query: mocks.dbQuery
  }
}));

import {
  shouldRequireTenantPublicIngressOrigin,
  tenantScopeFromPublicIngressRequest
} from "@/server/tenant-public-ingress";

const ORIGINAL_ENV = { ...process.env };

function requestWithHeaders(headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/portal/tickets", { headers });
}

describe("tenant public ingress", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.dbQuery.mockResolvedValue({ rows: [] });
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("keeps primary fallback only when strict public origin mapping is disabled", async () => {
    process.env = {
      ...ORIGINAL_ENV,
      NODE_ENV: "test",
      TENANT_PUBLIC_INGRESS_REQUIRE_ORIGIN: "false"
    };

    await expect(tenantScopeFromPublicIngressRequest(requestWithHeaders())).resolves.toEqual({
      tenantKey: "primary",
      workspaceKey: "primary"
    });
  });

  it("requires trusted public origins by default in production", async () => {
    process.env = { ...ORIGINAL_ENV, NODE_ENV: "production" };

    expect(shouldRequireTenantPublicIngressOrigin()).toBe(true);
    await expect(
      tenantScopeFromPublicIngressRequest(
        requestWithHeaders({ origin: "https://unknown.example.com" })
      )
    ).rejects.toMatchObject({
      code: "tenant_public_origin_untrusted",
      status: 403
    });
  });

  it("resolves trusted origins from env configuration", async () => {
    process.env = {
      ...ORIGINAL_ENV,
      NODE_ENV: "production",
      TENANT_PUBLIC_INGRESS_ORIGINS_JSON: JSON.stringify({
        "https://support.example.com": {
          tenantKey: "tenant-a",
          workspaceKey: "workspace-a"
        }
      })
    };

    await expect(
      tenantScopeFromPublicIngressRequest(
        requestWithHeaders({ origin: "https://support.example.com/form" })
      )
    ).resolves.toEqual({
      tenantKey: "tenant-a",
      workspaceKey: "workspace-a"
    });
    expect(mocks.dbQuery).not.toHaveBeenCalled();
  });

  it("resolves trusted origins from database configuration", async () => {
    process.env = {
      ...ORIGINAL_ENV,
      NODE_ENV: "production"
    };
    mocks.dbQuery.mockResolvedValue({
      rows: [{ tenant_key: "tenant-a", workspace_key: "workspace-a" }]
    });

    await expect(
      tenantScopeFromPublicIngressRequest(
        requestWithHeaders({ origin: "https://support.example.com" })
      )
    ).resolves.toEqual({
      tenantKey: "tenant-a",
      workspaceKey: "workspace-a"
    });
    expect(mocks.dbQuery).toHaveBeenCalledWith(
      expect.stringContaining("tenant_public_ingress_origins"),
      expect.arrayContaining([expect.arrayContaining(["https://support.example.com"])])
    );
  });

  it("rejects ambiguous active origin ownership", async () => {
    process.env = {
      ...ORIGINAL_ENV,
      NODE_ENV: "production"
    };
    mocks.dbQuery.mockResolvedValue({
      rows: [
        { tenant_key: "tenant-a", workspace_key: "workspace-a" },
        { tenant_key: "tenant-b", workspace_key: "workspace-b" }
      ]
    });

    await expect(
      tenantScopeFromPublicIngressRequest(
        requestWithHeaders({ origin: "https://support.example.com" })
      )
    ).rejects.toMatchObject({
      code: "tenant_public_origin_ambiguous",
      status: 409
    });
  });
});
