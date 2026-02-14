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

import { GET } from "@/app/api/admin/profile-lookup/metrics/route";

function buildUser(roleName: "lead_admin" | "agent") {
  return {
    id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    email: `${roleName}@6ex.co.za`,
    display_name: roleName,
    role_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    role_name: roleName
  };
}

describe("GET /api/admin/profile-lookup/metrics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 403 for non-admin users", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser("agent"));

    const response = await GET(
      new Request("http://localhost/api/admin/profile-lookup/metrics?days=14")
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toMatchObject({ error: "Forbidden" });
    expect(mocks.dbQuery).not.toHaveBeenCalled();
  });

  it("returns computed profile lookup metrics for lead admin", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser("lead_admin"));
    mocks.dbQuery
      .mockResolvedValueOnce({
        rows: [
          {
            total: 20,
            matched: 12,
            missed: 5,
            errored: 3,
            disabled: 0,
            timeout_errors: 2,
            avg_duration_ms: 212.45,
            p95_duration_ms: 488.1
          }
        ]
      })
      .mockResolvedValueOnce({
        rows: [
          { day: "2026-02-12", matched: 6, missed: 2, errored: 1, disabled: 0 },
          { day: "2026-02-13", matched: 6, missed: 3, errored: 2, disabled: 0 }
        ]
      });

    const response = await GET(
      new Request("http://localhost/api/admin/profile-lookup/metrics?days=500")
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.windowDays).toBe(90);
    expect(body.summary).toMatchObject({
      total: 20,
      matched: 12,
      missed: 5,
      errored: 3,
      disabled: 0,
      timeoutErrors: 2,
      hitRate: 60,
      missRate: 25,
      errorRate: 15,
      timeoutErrorRate: 10,
      avgDurationMs: 212.45,
      p95DurationMs: 488.1
    });
    expect(body.series).toHaveLength(2);
    expect(mocks.dbQuery).toHaveBeenCalledTimes(2);
    expect(mocks.dbQuery).toHaveBeenNthCalledWith(1, expect.any(String), [90]);
    expect(mocks.dbQuery).toHaveBeenNthCalledWith(2, expect.any(String), [90]);
  });
});

