import { beforeEach, describe, expect, it, vi } from "vitest";

const TENANT_ID = "99999999-9999-4999-8999-999999999999";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  dbQuery: vi.fn()
}));

vi.mock("@/server/auth/session", () => ({
  getSessionUser: mocks.getSessionUser
}));

vi.mock("@/server/db", () => ({
  db: {
    query: mocks.dbQuery
  }
}));

import { GET } from "@/app/api/analytics/performance/route";

function buildUser(tenantId: string | null = TENANT_ID) {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    email: "agent@example.com",
    display_name: "Agent",
    role_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    role_name: "lead_admin",
    tenant_id: tenantId
  };
}

describe("analytics performance tenant scope", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSessionUser.mockResolvedValue(buildUser());
    mocks.dbQuery.mockResolvedValue({ rows: [] });
  });

  it("rejects tenantless sessions before analytics SQL", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser(null));

    const response = await GET(
      new Request("http://localhost/api/analytics/performance?start=2026-01-01&end=2026-01-31")
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toMatchObject({ error: "Forbidden" });
    expect(mocks.dbQuery).not.toHaveBeenCalled();
  });

  it("filters tag analytics by tenant and tenant-owned tag links", async () => {
    const response = await GET(
      new Request(
        "http://localhost/api/analytics/performance?start=2026-01-01&end=2026-01-31&groupBy=tag&tag=VIP"
      )
    );

    expect(response.status).toBe(200);
    const [sql, values] = mocks.dbQuery.mock.calls[0] ?? [];
    expect(sql).toContain("t.tenant_id = $3");
    expect(sql).toContain("tt.tenant_id = t.tenant_id");
    expect(sql).toContain("tag.tenant_id = t.tenant_id");
    expect(sql).toContain("m.tenant_id = t.tenant_id");
    expect(values).toEqual([
      new Date("2026-01-01T00:00:00.000Z"),
      new Date("2026-02-01T00:00:00.000Z"),
      TENANT_ID,
      "vip"
    ]);
  });
});
