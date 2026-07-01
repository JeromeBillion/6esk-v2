import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  isLeadAdmin: vi.fn(),
  dbQuery: vi.fn(),
  dbConnect: vi.fn(),
  clientQuery: vi.fn(),
  clientRelease: vi.fn(),
  hashPassword: vi.fn(),
  recordAuditLog: vi.fn(),
  getEnv: vi.fn()
}));

vi.mock("@/server/auth/session", () => ({
  getSessionUser: mocks.getSessionUser
}));

vi.mock("@/server/auth/roles", () => ({
  isLeadAdmin: mocks.isLeadAdmin
}));

vi.mock("@/server/db", () => ({
  db: {
    query: mocks.dbQuery,
    connect: mocks.dbConnect
  }
}));

vi.mock("@/server/auth/password", () => ({
  hashPassword: mocks.hashPassword
}));

vi.mock("@/server/audit", () => ({
  recordAuditLog: mocks.recordAuditLog
}));

vi.mock("@/server/env", () => ({
  getEnv: mocks.getEnv
}));

import { GET as getRoles } from "@/app/api/admin/roles/route";
import { GET as getUsers, POST as postUser } from "@/app/api/admin/users/route";
import { PATCH as patchUser } from "@/app/api/admin/users/[userId]/route";
import { POST as postPasswordReset } from "@/app/api/admin/users/[userId]/password-reset/route";

const TENANT_ID = "11111111-1111-1111-1111-111111111111";
const USER_ID = "22222222-2222-2222-2222-222222222222";
const ROLE_ID = "33333333-3333-3333-3333-333333333333";

function buildUser(overrides: Record<string, unknown> = {}) {
  return {
    id: USER_ID,
    email: "admin@example.com",
    display_name: "Admin",
    role_id: ROLE_ID,
    role_name: "lead_admin",
    tenant_id: TENANT_ID,
    real_tenant_id: TENANT_ID,
    ...overrides
  };
}

describe("admin users and roles tenant scope", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSessionUser.mockResolvedValue(buildUser());
    mocks.isLeadAdmin.mockReturnValue(true);
    mocks.hashPassword.mockResolvedValue("hashed-password");
    mocks.recordAuditLog.mockResolvedValue(undefined);
    mocks.getEnv.mockReturnValue({ APP_URL: "https://desk.example.com" });
    mocks.dbConnect.mockResolvedValue({
      query: mocks.clientQuery,
      release: mocks.clientRelease
    });
    mocks.clientQuery.mockResolvedValue({ rows: [] });
  });

  it("lists only tenant-scoped roles", async () => {
    mocks.dbQuery.mockResolvedValueOnce({
      rows: [{ id: ROLE_ID, name: "lead_admin", description: "Lead admin" }]
    });

    const response = await getRoles();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.roles).toHaveLength(1);
    expect(mocks.dbQuery).toHaveBeenCalledWith(expect.stringContaining("WHERE tenant_id = $1"), [
      TENANT_ID
    ]);
  });

  it("rejects admin role reads when the session has no tenant scope", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser({ tenant_id: "" }));

    const response = await getRoles();
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toMatchObject({ error: "Forbidden" });
    expect(mocks.dbQuery).not.toHaveBeenCalled();
  });

  it("lists users with a tenant-bound role join", async () => {
    mocks.dbQuery.mockResolvedValueOnce({ rows: [] });

    const response = await getUsers();

    expect(response.status).toBe(200);
    expect(mocks.dbQuery).toHaveBeenCalledWith(
      expect.stringContaining("r.tenant_id = u.tenant_id"),
      [TENANT_ID]
    );
  });

  it("creates users, personal mailboxes, and mailbox membership through tenant scope", async () => {
    mocks.dbQuery.mockResolvedValueOnce({ rows: [{ id: ROLE_ID }] });
    mocks.clientQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "44444444-4444-4444-4444-444444444444",
            email: "new@example.com",
            display_name: "New User",
            role_id: ROLE_ID
          }
        ]
      })
      .mockResolvedValueOnce({ rows: [{ id: "mailbox-1" }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const response = await postUser(
      new Request("https://desk.example.com/api/admin/users", {
        method: "POST",
        body: JSON.stringify({
          email: "New@Example.com",
          displayName: "New User",
          password: "password-123",
          roleId: ROLE_ID
        })
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.clientQuery).toHaveBeenNthCalledWith(1, "BEGIN");
    expect(mocks.clientQuery).toHaveBeenNthCalledWith(
      5,
      expect.stringContaining("INSERT INTO mailboxes"),
      ["new@example.com", "44444444-4444-4444-4444-444444444444", TENANT_ID]
    );
    expect(mocks.clientQuery).toHaveBeenNthCalledWith(
      6,
      expect.stringContaining("INSERT INTO mailbox_memberships (tenant_id, mailbox_id, user_id, access_level)"),
      ["44444444-4444-4444-4444-444444444444", "mailbox-1", TENANT_ID]
    );
    expect(mocks.clientQuery.mock.calls[4][0]).toContain("WHERE mailboxes.tenant_id = EXCLUDED.tenant_id");
    expect(mocks.clientQuery.mock.calls[5][0]).toContain("VALUES ($3, $2, $1, 'owner')");
    expect(mocks.clientQuery).toHaveBeenNthCalledWith(7, "COMMIT");
    expect(mocks.clientRelease).toHaveBeenCalled();
  });

  it("rolls back user provisioning when mailbox membership creation fails", async () => {
    mocks.dbQuery.mockResolvedValueOnce({ rows: [{ id: ROLE_ID }] });
    mocks.clientQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "44444444-4444-4444-4444-444444444444",
            email: "new@example.com",
            display_name: "New User",
            role_id: ROLE_ID
          }
        ]
      })
      .mockResolvedValueOnce({ rows: [{ id: "mailbox-1" }] })
      .mockRejectedValueOnce(new Error("membership insert failed"))
      .mockResolvedValueOnce({ rows: [] });

    await expect(
      postUser(
        new Request("https://desk.example.com/api/admin/users", {
          method: "POST",
          body: JSON.stringify({
            email: "New@Example.com",
            displayName: "New User",
            password: "password-123",
            roleId: ROLE_ID
          })
        })
      )
    ).rejects.toThrow("membership insert failed");

    expect(mocks.clientQuery).toHaveBeenCalledWith("ROLLBACK");
    expect(mocks.clientQuery).not.toHaveBeenCalledWith("COMMIT");
    expect(mocks.clientRelease).toHaveBeenCalled();
    expect(mocks.recordAuditLog).not.toHaveBeenCalled();
  });

  it("rejects user creation when the role is outside the tenant", async () => {
    mocks.dbQuery.mockResolvedValueOnce({ rows: [] });

    const response = await postUser(
      new Request("https://desk.example.com/api/admin/users", {
        method: "POST",
        body: JSON.stringify({
          email: "new@example.com",
          displayName: "New User",
          password: "password-123",
          roleId: ROLE_ID
        })
      })
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toMatchObject({ error: "Invalid role" });
    expect(mocks.hashPassword).not.toHaveBeenCalled();
  });

  it("rejects cross-tenant email conflicts instead of updating another tenant", async () => {
    mocks.dbQuery.mockResolvedValueOnce({ rows: [{ id: ROLE_ID }] });
    mocks.clientQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const response = await postUser(
      new Request("https://desk.example.com/api/admin/users", {
        method: "POST",
        body: JSON.stringify({
          email: "taken@example.com",
          displayName: "Taken",
          password: "password-123",
          roleId: ROLE_ID
        })
      })
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toMatchObject({ error: "Email belongs to another tenant" });
    expect(mocks.clientQuery).toHaveBeenCalledWith("ROLLBACK");
    expect(mocks.clientQuery).not.toHaveBeenCalledWith(expect.stringContaining("INSERT INTO mailboxes"), expect.any(Array));
    expect(mocks.clientRelease).toHaveBeenCalled();
  });

  it("rejects personal mailbox creation when the address belongs to another tenant", async () => {
    mocks.dbQuery.mockResolvedValueOnce({ rows: [{ id: ROLE_ID }] });
    mocks.clientQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ tenant_id: "99999999-9999-9999-9999-999999999999" }] })
      .mockResolvedValueOnce({ rows: [] });

    const response = await postUser(
      new Request("https://desk.example.com/api/admin/users", {
        method: "POST",
        body: JSON.stringify({
          email: "mailbox-owner@example.com",
          displayName: "Mailbox Owner",
          password: "password-123",
          roleId: ROLE_ID
        })
      })
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toMatchObject({ error: "Mailbox address belongs to another tenant" });
    expect(mocks.hashPassword).toHaveBeenCalled();
    expect(mocks.clientQuery).toHaveBeenCalledWith("ROLLBACK");
    expect(mocks.clientQuery).not.toHaveBeenCalledWith(expect.stringContaining("INSERT INTO users"), expect.any(Array));
    expect(mocks.clientRelease).toHaveBeenCalled();
  });

  it("rejects user role updates when the new role is outside the tenant", async () => {
    mocks.dbQuery
      .mockResolvedValueOnce({
        rows: [{ id: "target-user", email: "target@example.com", role_id: ROLE_ID, is_active: true }]
      })
      .mockResolvedValueOnce({ rows: [] });

    const response = await patchUser(
      new Request("https://desk.example.com/api/admin/users/target-user", {
        method: "PATCH",
        body: JSON.stringify({ roleId: "44444444-4444-4444-4444-444444444444" })
      }),
      { params: Promise.resolve({ userId: "target-user" }) }
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toMatchObject({ error: "Invalid role" });
  });

  it("rejects admin password resets when the session has no tenant scope", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser({ tenant_id: null }));

    const response = await postPasswordReset(new Request("https://desk.example.com"), {
      params: Promise.resolve({ userId: "target-user" })
    });

    expect(response.status).toBe(403);
    expect(mocks.dbQuery).not.toHaveBeenCalled();
  });

  it("creates password reset tokens under the admin tenant", async () => {
    mocks.dbQuery
      .mockResolvedValueOnce({ rows: [{ id: "target-user", email: "target@example.com" }] })
      .mockResolvedValueOnce({ rows: [] });

    const response = await postPasswordReset(new Request("https://desk.example.com"), {
      params: Promise.resolve({ userId: "target-user" })
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ status: "created" });
    expect(mocks.dbQuery).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("INSERT INTO password_resets (tenant_id, user_id, token_hash, expires_at)"),
      ["target-user", expect.any(String), expect.any(Date), TENANT_ID]
    );
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(expect.objectContaining({ tenantId: TENANT_ID }));
  });
});
