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

import { GET } from "@/app/api/admin/inbound/failed/route";

const TENANT_ID = "22222222-2222-4222-8222-222222222222";

function buildUser(roleName: "lead_admin" | "agent", tenantId: string | null = TENANT_ID) {
  return {
    id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    email: `${roleName}@example.com`,
    display_name: roleName,
    role_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    role_name: roleName,
    tenant_id: tenantId
  };
}

describe("GET /api/admin/inbound/failed", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.dbQuery.mockResolvedValue({
      rows: [
        {
          id: "event-1",
          idempotency_key: "message-id:1",
          attempt_count: 2,
          last_error: "timeout",
          next_attempt_at: "2026-01-01T00:00:00.000Z",
          created_at: "2026-01-01T00:00:00.000Z"
        }
      ]
    });
  });

  it("returns 403 for non-admin users", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser("agent"));

    const response = await GET(new Request("http://localhost/api/admin/inbound/failed"));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toMatchObject({ error: "Forbidden" });
    expect(mocks.dbQuery).not.toHaveBeenCalled();
  });

  it("returns 403 for admin sessions without tenant scope", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser("lead_admin", null));

    const response = await GET(new Request("http://localhost/api/admin/inbound/failed"));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toMatchObject({ error: "Forbidden" });
    expect(mocks.dbQuery).not.toHaveBeenCalled();
  });

  it("lists failed inbound events for the session tenant", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser("lead_admin"));

    const response = await GET(new Request("http://localhost/api/admin/inbound/failed?limit=25"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.events).toHaveLength(1);
    expect(mocks.dbQuery).toHaveBeenCalledWith(
      expect.stringContaining("AND tenant_id = $1"),
      [TENANT_ID, 25]
    );
  });
});
