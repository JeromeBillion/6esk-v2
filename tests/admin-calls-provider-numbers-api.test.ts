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

import { DELETE, GET, POST } from "@/app/api/admin/calls/provider-numbers/route";

const TENANT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

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

const PROVIDER_NUMBER_ROW = {
  id: "11111111-1111-4111-8111-111111111111",
  provider: "twilio",
  phone_number: "+27110000000",
  account_sid: "AC123",
  status: "active",
  metadata: { region: "za" },
  created_by_user_id: USER_ID,
  created_at: "2026-05-31T08:00:00.000Z",
  updated_at: "2026-05-31T08:00:00.000Z"
};

describe("/api/admin/calls/provider-numbers", () => {
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

  it("lists provider numbers inside the admin tenant workspace", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser("tenant_admin"));
    mocks.dbQuery.mockResolvedValueOnce({ rows: [PROVIDER_NUMBER_ROW] });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.numbers).toEqual([
      expect.objectContaining({
        id: PROVIDER_NUMBER_ROW.id,
        provider: "twilio",
        phoneNumber: "+27110000000",
        accountSid: "AC123",
        status: "active"
      })
    ]);
    expect(mocks.dbQuery).toHaveBeenCalledWith(expect.stringContaining("WHERE tenant_id = $1"), [
      TENANT_ID,
      "primary"
    ]);
  });

  it("creates a normalized tenant-scoped provider number and records audit", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser("tenant_admin"));
    mocks.dbQuery.mockResolvedValueOnce({ rows: [PROVIDER_NUMBER_ROW] });

    const response = await POST(
      new Request("http://localhost/api/admin/calls/provider-numbers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          provider: "Twilio",
          phoneNumber: "+27 11 000 0000",
          accountSid: "AC123",
          status: "active",
          metadata: { region: "za" }
        })
      })
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body).toMatchObject({
      status: "created",
      number: { id: PROVIDER_NUMBER_ROW.id, phoneNumber: "+27110000000" }
    });
    expect(mocks.dbQuery).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO call_provider_numbers"), [
      TENANT_ID,
      "primary",
      "twilio",
      "+27110000000",
      "AC123",
      "active",
      JSON.stringify({ region: "za" }),
      USER_ID
    ]);
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT_ID,
        actorUserId: USER_ID,
        action: "call_provider_number_created",
        entityId: PROVIDER_NUMBER_ROW.id
      })
    );
  });

  it("updates only tenant-owned provider numbers", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser("tenant_admin"));
    mocks.dbQuery.mockResolvedValueOnce({
      rows: [{ ...PROVIDER_NUMBER_ROW, status: "paused" }]
    });

    const response = await POST(
      new Request("http://localhost/api/admin/calls/provider-numbers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: PROVIDER_NUMBER_ROW.id,
          provider: "twilio",
          phoneNumber: "+27 11 000 0000",
          accountSid: "AC123",
          status: "paused"
        })
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ status: "updated", number: { status: "paused" } });
    expect(mocks.dbQuery).toHaveBeenCalledWith(expect.stringContaining("WHERE id = $6"), [
      "twilio",
      "+27110000000",
      "AC123",
      "paused",
      JSON.stringify({}),
      PROVIDER_NUMBER_ROW.id,
      TENANT_ID,
      "primary"
    ]);
  });

  it("soft-disables provider numbers instead of deleting them", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser("tenant_admin"));
    mocks.dbQuery.mockResolvedValueOnce({
      rows: [{ ...PROVIDER_NUMBER_ROW, status: "inactive" }]
    });

    const response = await DELETE(
      new Request(
        `http://localhost/api/admin/calls/provider-numbers?id=${PROVIDER_NUMBER_ROW.id}`,
        { method: "DELETE" }
      )
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ status: "deactivated", number: { status: "inactive" } });
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT_ID,
        action: "call_provider_number_deactivated",
        entityId: PROVIDER_NUMBER_ROW.id
      })
    );
  });
});
