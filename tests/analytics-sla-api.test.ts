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

import { GET } from "@/app/api/analytics/sla/route";

function buildUser(tenantId: string | null = TENANT_ID) {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    email: "agent@example.com",
    display_name: "Agent",
    role_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    role_name: "agent",
    tenant_id: tenantId
  };
}

describe("analytics SLA API tenant scope", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSessionUser.mockResolvedValue(buildUser());
    mocks.dbQuery
      .mockResolvedValueOnce({
        rows: [{ first_response_target_minutes: 60, resolution_target_minutes: 720 }]
      })
      .mockResolvedValueOnce({ rows: [{ total: 3, compliant: 2 }] })
      .mockResolvedValueOnce({ rows: [{ total: 2, compliant: 1 }] });
  });

  it("rejects tenantless sessions before SLA analytics reads", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser(null));

    const response = await GET(new Request("https://desk.example.com/api/analytics/sla"));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toMatchObject({ error: "Forbidden" });
    expect(mocks.dbQuery).not.toHaveBeenCalled();
  });

  it("computes SLA analytics only under the session tenant", async () => {
    const response = await GET(new Request("https://desk.example.com/api/analytics/sla"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.targets).toEqual({ firstResponseMinutes: 60, resolutionMinutes: 720 });
    expect(mocks.dbQuery).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("WHERE tenant_id = $1"),
      [TENANT_ID]
    );
    expect(mocks.dbQuery.mock.calls[1]?.[0]).toContain("m.tenant_id = t.tenant_id");
    expect(mocks.dbQuery.mock.calls[1]?.[0]).toContain("t.tenant_id = $4");
    expect(mocks.dbQuery.mock.calls[1]?.[1]).toEqual([
      expect.any(Date),
      expect.any(Date),
      60,
      TENANT_ID
    ]);
    expect(mocks.dbQuery.mock.calls[2]?.[0]).toContain("t.tenant_id = $4");
    expect(mocks.dbQuery.mock.calls[2]?.[1]).toEqual([
      expect.any(Date),
      expect.any(Date),
      720,
      TENANT_ID
    ]);
  });
});
