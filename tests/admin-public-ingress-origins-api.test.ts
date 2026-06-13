import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  dbQuery: vi.fn(),
  recordAuditLog: vi.fn()
}));

vi.mock("@/server/auth/session", () => ({
  getSessionUser: mocks.getSessionUser
}));

vi.mock("@/server/db", () => ({
  db: {
    query: mocks.dbQuery
  }
}));

vi.mock("@/server/audit", () => ({
  recordAuditLog: mocks.recordAuditLog
}));

import { DELETE, GET, POST } from "@/app/api/admin/tenant/public-ingress-origins/route";

const TENANT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ORIGIN_ID = "11111111-1111-4111-8111-111111111111";

function buildUser(roleName: "tenant_admin" | "agent") {
  return {
    id: USER_ID,
    email: `${roleName}@example.test`,
    display_name: roleName,
    role_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    role_name: roleName,
    tenant_id: TENANT_ID,
    tenant_slug: "acme",
    real_tenant_id: TENANT_ID,
    is_impersonating: false
  };
}

function originRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: ORIGIN_ID,
    origin: "https://support.example.test",
    status: "active",
    metadata: { verificationStatus: "verified" },
    created_at: "2026-06-13T08:00:00.000Z",
    updated_at: "2026-06-13T08:00:00.000Z",
    ...overrides
  };
}

describe("/api/admin/tenant/public-ingress-origins", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.recordAuditLog.mockResolvedValue(undefined);
  });

  it("returns 403 for non-admin users", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser("agent"));

    const response = await GET();

    expect(response.status).toBe(403);
    expect(mocks.dbQuery).not.toHaveBeenCalled();
  });

  it("lists only the current tenant public origins", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser("tenant_admin"));
    mocks.dbQuery.mockResolvedValueOnce({ rows: [originRow()] });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.origins).toEqual([
      expect.objectContaining({
        id: ORIGIN_ID,
        origin: "https://support.example.test",
        verificationStatus: "verified"
      })
    ]);
    expect(mocks.dbQuery).toHaveBeenCalledWith(expect.stringContaining("WHERE tenant_id = $1"), [
      TENANT_ID,
      "primary"
    ]);
  });

  it("creates a normalized active origin and audits the change", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser("tenant_admin"));
    mocks.dbQuery.mockResolvedValueOnce({ rows: [originRow()] });

    const response = await POST(
      new Request("http://localhost/api/admin/tenant/public-ingress-origins", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          origin: "https://Support.Example.test/form",
          verificationStatus: "verified"
        })
      })
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body).toMatchObject({
      status: "created",
      origin: {
        id: ORIGIN_ID,
        origin: "https://support.example.test"
      }
    });
    expect(mocks.dbQuery.mock.calls[0][1]).toEqual([
      TENANT_ID,
      "primary",
      "https://support.example.test",
      "active",
      JSON.stringify({ verificationStatus: "verified" }),
      USER_ID
    ]);
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT_ID,
        action: "tenant_public_ingress_origin_created",
        entityId: ORIGIN_ID
      })
    );
  });

  it("deactivates origins inside tenant scope", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser("tenant_admin"));
    mocks.dbQuery.mockResolvedValueOnce({ rows: [originRow({ status: "inactive" })] });

    const response = await DELETE(
      new Request(`http://localhost/api/admin/tenant/public-ingress-origins?id=${ORIGIN_ID}`, {
        method: "DELETE"
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      status: "deactivated",
      origin: { id: ORIGIN_ID, status: "inactive" }
    });
    expect(mocks.dbQuery.mock.calls[0][1]).toEqual([ORIGIN_ID, TENANT_ID, "primary"]);
  });
});
