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

import { GET } from "@/app/api/support/macros/route";

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

describe("support macros API tenant scope", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSessionUser.mockResolvedValue(buildUser());
    mocks.dbQuery.mockResolvedValue({ rows: [] });
  });

  it("rejects tenantless sessions before macro reads", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser(null));

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toMatchObject({ error: "Forbidden" });
    expect(mocks.dbQuery).not.toHaveBeenCalled();
  });

  it("lists active macros only under the session tenant", async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    expect(mocks.dbQuery).toHaveBeenCalledWith(
      expect.stringContaining("WHERE tenant_id = $1"),
      [TENANT_ID]
    );
  });
});
