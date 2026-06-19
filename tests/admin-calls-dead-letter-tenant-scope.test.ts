import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  dbQuery: vi.fn(),
  clientQuery: vi.fn(),
  clientRelease: vi.fn(),
  redactCallData: vi.fn((value) => value)
}));

vi.mock("@/server/auth/session", () => ({
  getSessionUser: mocks.getSessionUser
}));

vi.mock("@/server/db", () => ({
  db: {
    query: mocks.dbQuery,
    connect: vi.fn(async () => ({
      query: mocks.clientQuery,
      release: mocks.clientRelease
    }))
  }
}));

vi.mock("@/server/calls/redaction", () => ({
  redactCallData: mocks.redactCallData
}));

import { GET, PATCH, POST } from "@/app/api/admin/calls/dead-letter/route";

const TENANT_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const EVENT_ID = "33333333-3333-4333-8333-333333333333";

function buildUser(tenantId: string | null = TENANT_ID) {
  return {
    id: USER_ID,
    email: "lead@example.test",
    display_name: "Lead",
    role_id: "role-1",
    role_name: "lead_admin",
    tenant_id: tenantId
  };
}

function jsonRequest(body: unknown) {
  return new Request("http://localhost/api/admin/calls/dead-letter", {
    method: "POST",
    body: JSON.stringify(body)
  });
}

describe("/api/admin/calls/dead-letter tenant scope", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSessionUser.mockResolvedValue(buildUser());
    mocks.dbQuery.mockResolvedValue({ rows: [] });
    mocks.clientQuery.mockImplementation(async (sql: string) => {
      if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") {
        return { rows: [] };
      }
      if (sql.includes("SELECT id, call_session_id, tenant_id")) {
        return {
          rows: [
            {
              id: EVENT_ID,
              call_session_id: "call-1",
              tenant_id: TENANT_ID
            }
          ]
        };
      }
      if (sql.includes("UPDATE call_outbox_events") && sql.includes("RETURNING id")) {
        return { rows: [{ id: EVENT_ID }] };
      }
      return { rows: [] };
    });
  });

  it("rejects lead-admin-shaped sessions without tenant scope", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser(null));

    const getResponse = await GET(new Request("http://localhost/api/admin/calls/dead-letter"));
    const patchResponse = await PATCH(jsonRequest({ eventId: EVENT_ID, action: "recover" }));
    const postResponse = await POST(jsonRequest({ action: "recover", eventIds: [EVENT_ID] }));

    expect(getResponse.status).toBe(403);
    expect(patchResponse.status).toBe(403);
    expect(postResponse.status).toBe(403);
    expect(mocks.dbQuery).not.toHaveBeenCalled();
    expect(mocks.clientQuery).not.toHaveBeenCalled();
  });

  it("lists only dead-letter events inside the admin tenant", async () => {
    await GET(
      new Request(
        "http://localhost/api/admin/calls/dead-letter?status=failed&callSessionId=call-1&limit=10"
      )
    );

    const [sql, values] = mocks.dbQuery.mock.calls[0] ?? [];
    expect(sql).toContain("WHERE tenant_id = $1");
    expect(sql).toContain("AND status = $2");
    expect(sql).toContain("AND call_session_id = $3");
    expect(values).toEqual([TENANT_ID, "failed", "call-1", 10]);
  });

  it("recovers a single event only inside the admin tenant and audits with tenant_id", async () => {
    const response = await PATCH(jsonRequest({ eventId: EVENT_ID, action: "recover", notes: "retry" }));

    expect(response.status).toBe(200);
    expect(mocks.clientQuery).toHaveBeenCalledWith(expect.stringContaining("WHERE id = $1"), [
      EVENT_ID,
      TENANT_ID
    ]);
    expect(mocks.clientQuery).toHaveBeenCalledWith(expect.stringContaining("UPDATE call_outbox_events"), [
      EVENT_ID,
      TENANT_ID
    ]);
    expect(mocks.clientQuery).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO audit_logs (tenant_id"),
      expect.arrayContaining([TENANT_ID, USER_ID, "dead_letter_recovered"])
    );
  });

  it("batch-recovers only scoped events and writes tenant-scoped audit evidence", async () => {
    const response = await POST(jsonRequest({ action: "recover", eventIds: [EVENT_ID], notes: "batch" }));

    expect(response.status).toBe(200);
    expect(mocks.clientQuery).toHaveBeenCalledWith(
      expect.stringContaining("WHERE tenant_id = $1 AND (status = 'failed' OR last_error IS NOT NULL) AND id = ANY($2)"),
      [TENANT_ID, [EVENT_ID]]
    );
    expect(mocks.clientQuery).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO audit_logs (tenant_id"),
      expect.arrayContaining([TENANT_ID, USER_ID, "dead_letter_batch_recovered"])
    );
  });
});
