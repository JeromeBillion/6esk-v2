import { beforeEach, describe, expect, it, vi } from "vitest";

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

import { GET } from "@/app/api/admin/calls/rejections/route";

function buildUser(roleName: "lead_admin" | "agent") {
  return {
    id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    email: `${roleName}@6ex.co.za`,
    display_name: roleName,
    role_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    role_name: roleName
  };
}

describe("GET /api/admin/calls/rejections", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 403 for non-admin users", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser("agent"));

    const response = await GET(new Request("http://localhost/api/admin/calls/rejections"));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toMatchObject({ error: "Forbidden" });
  });

  it("returns summary and recent webhook rejection rows", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser("lead_admin"));
    mocks.dbQuery
      .mockResolvedValueOnce({
        rows: [{ reason: "missing_timestamp", mode: "hmac", count: 2 }]
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "log-1",
            created_at: new Date("2026-02-18T10:00:00.000Z"),
            data: {
              reason: "missing_timestamp",
              endpoint: "/api/calls/status",
              fromPhone: "+15557654321"
            }
          }
        ]
      });

    const response = await GET(
      new Request("http://localhost/api/admin/calls/rejections?hours=24&limit=20")
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      windowHours: 24,
      summary: [{ reason: "missing_timestamp", mode: "hmac", count: 2 }]
    });
    expect(body.recent).toHaveLength(1);
    expect(body.recent[0]).toMatchObject({
      data: {
        reason: "missing_timestamp",
        endpoint: "/api/calls/status",
        fromPhone: "+1555******21"
      }
    });
    expect(mocks.dbQuery).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("created_at >= now()"),
      [24, 20]
    );
  });
});
