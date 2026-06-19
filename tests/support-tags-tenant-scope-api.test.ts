import { beforeEach, describe, expect, it, vi } from "vitest";

const TENANT_ID = "99999999-9999-4999-8999-999999999999";
const TAG_ID = "11111111-1111-4111-8111-111111111111";

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

import { GET, POST } from "@/app/api/support/tags/route";
import {
  DELETE as DELETE_TAG,
  PATCH as PATCH_TAG
} from "@/app/api/support/tags/[tagId]/route";

function buildUser(tenantId: string | null = TENANT_ID) {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    email: "admin@example.com",
    display_name: "Admin",
    role_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    role_name: "lead_admin",
    tenant_id: tenantId
  };
}

function jsonRequest(payload: Record<string, unknown>) {
  return new Request("http://localhost/api/support/tags", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
}

describe("support tag catalog tenant scope", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSessionUser.mockResolvedValue(buildUser());
    mocks.dbQuery.mockResolvedValue({ rows: [] });
    mocks.recordAuditLog.mockResolvedValue(undefined);
  });

  it("rejects tag listing before database access when the session has no tenant", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser(null));

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toMatchObject({ error: "Forbidden" });
    expect(mocks.dbQuery).not.toHaveBeenCalled();
  });

  it("lists only tags owned by the session tenant", async () => {
    mocks.dbQuery.mockResolvedValueOnce({
      rows: [{ id: TAG_ID, name: "vip", description: "VIP clients" }]
    });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.tags).toHaveLength(1);
    expect(mocks.dbQuery).toHaveBeenCalledWith(
      expect.stringContaining("WHERE tenant_id = $1"),
      [TENANT_ID]
    );
  });

  it("creates and audits tags under the session tenant", async () => {
    mocks.dbQuery
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({
        rows: [{ id: TAG_ID, name: "vip", description: "VIP clients" }]
      });

    const response = await POST(jsonRequest({ name: "VIP", description: "VIP clients" }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.tag).toMatchObject({ id: TAG_ID, name: "vip" });
    expect(mocks.dbQuery).toHaveBeenNthCalledWith(
      1,
      "SELECT id FROM tags WHERE tenant_id = $1 AND name = $2 LIMIT 1",
      [TENANT_ID, "vip"]
    );
    expect(mocks.dbQuery).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("INSERT INTO tags (tenant_id, name, description)"),
      [TENANT_ID, "vip", "VIP clients"]
    );
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT_ID,
        action: "tag_created",
        entityId: TAG_ID
      })
    );
  });

  it("updates tags with an id and tenant predicate", async () => {
    mocks.dbQuery.mockResolvedValueOnce({
      rows: [{ id: TAG_ID, name: "priority", description: null }]
    });

    const response = await PATCH_TAG(jsonRequest({ name: "Priority" }), {
      params: Promise.resolve({ tagId: TAG_ID })
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.tag).toMatchObject({ id: TAG_ID, name: "priority" });
    expect(mocks.dbQuery).toHaveBeenCalledWith(
      expect.stringContaining("AND tenant_id = $3"),
      ["priority", TAG_ID, TENANT_ID]
    );
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT_ID,
        action: "tag_updated",
        entityId: TAG_ID
      })
    );
  });

  it("deletes only tags owned by the session tenant", async () => {
    mocks.dbQuery.mockResolvedValueOnce({ rows: [{ id: TAG_ID }] });

    const response = await DELETE_TAG(new Request(`http://localhost/api/support/tags/${TAG_ID}`), {
      params: Promise.resolve({ tagId: TAG_ID })
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ status: "deleted" });
    expect(mocks.dbQuery).toHaveBeenCalledWith(
      "DELETE FROM tags WHERE id = $1 AND tenant_id = $2 RETURNING id",
      [TAG_ID, TENANT_ID]
    );
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT_ID,
        action: "tag_deleted",
        entityId: TAG_ID
      })
    );
  });
});
