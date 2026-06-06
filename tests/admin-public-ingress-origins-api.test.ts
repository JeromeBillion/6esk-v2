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

const ORIGIN_ROW = {
  id: "11111111-1111-1111-1111-111111111111",
  origin: "https://support.example.com",
  status: "active",
  metadata: { verificationStatus: "verified", provider: "cloudflare" },
  created_at: "2026-05-31T08:00:00.000Z",
  updated_at: "2026-05-31T08:00:00.000Z"
};

function buildUser(roleName: "lead_admin" | "agent") {
  return {
    id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    email: `${roleName}@example.test`,
    display_name: roleName,
    role_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    role_name: roleName,
    tenant_key: "tenant-a",
    workspace_key: "workspace-a"
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

  it("lists tenant-owned public ingress origins", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser("lead_admin"));
    mocks.dbQuery.mockResolvedValueOnce({ rows: [ORIGIN_ROW] });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.origins).toEqual([
      expect.objectContaining({
        id: ORIGIN_ROW.id,
        origin: "https://support.example.com",
        status: "active",
        verificationStatus: "verified"
      })
    ]);
    expect(mocks.dbQuery).toHaveBeenCalledWith(expect.stringContaining("WHERE tenant_key = $1"), [
      "tenant-a",
      "workspace-a"
    ]);
  });

  it("creates a normalized tenant public ingress origin and records audit", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser("lead_admin"));
    mocks.dbQuery.mockResolvedValueOnce({ rows: [ORIGIN_ROW] });

    const response = await POST(
      new Request("http://localhost/api/admin/tenant/public-ingress-origins", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          origin: "https://Support.Example.com/help",
          status: "active",
          verificationStatus: "verified",
          metadata: { provider: "cloudflare" }
        })
      })
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body).toMatchObject({
      status: "created",
      origin: { id: ORIGIN_ROW.id, origin: "https://support.example.com" }
    });
    expect(mocks.dbQuery).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO tenant_public_ingress_origins"),
      [
        "tenant-a",
        "workspace-a",
        "https://support.example.com",
        "active",
        JSON.stringify({ provider: "cloudflare", verificationStatus: "verified" })
      ]
    );
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantKey: "tenant-a",
        workspaceKey: "workspace-a",
        action: "tenant_public_ingress_origin_created",
        entityId: ORIGIN_ROW.id
      })
    );
  });

  it("updates only tenant-owned public ingress origins", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser("lead_admin"));
    mocks.dbQuery.mockResolvedValueOnce({ rows: [{ ...ORIGIN_ROW, status: "paused" }] });

    const response = await POST(
      new Request("http://localhost/api/admin/tenant/public-ingress-origins", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: ORIGIN_ROW.id,
          origin: "support.example.com",
          status: "paused",
          verificationStatus: "pending"
        })
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ status: "updated", origin: { status: "paused" } });
    expect(mocks.dbQuery).toHaveBeenCalledWith(expect.stringContaining("WHERE id = $4"), [
      "support.example.com",
      "paused",
      JSON.stringify({ verificationStatus: "pending" }),
      ORIGIN_ROW.id,
      "tenant-a",
      "workspace-a"
    ]);
  });

  it("returns a conflict when an active origin is already owned", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser("lead_admin"));
    mocks.dbQuery.mockRejectedValueOnce(Object.assign(new Error("duplicate"), { code: "23505" }));

    const response = await POST(
      new Request("http://localhost/api/admin/tenant/public-ingress-origins", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ origin: "https://support.example.com", status: "active" })
      })
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toMatchObject({ code: "public_ingress_origin_conflict" });
  });

  it("soft-disables tenant-owned origins instead of deleting them", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser("lead_admin"));
    mocks.dbQuery.mockResolvedValueOnce({ rows: [{ ...ORIGIN_ROW, status: "inactive" }] });

    const response = await DELETE(
      new Request(
        `http://localhost/api/admin/tenant/public-ingress-origins?id=${ORIGIN_ROW.id}`,
        { method: "DELETE" }
      )
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ status: "deactivated", origin: { status: "inactive" } });
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "tenant_public_ingress_origin_deactivated",
        entityId: ORIGIN_ROW.id
      })
    );
  });
});
