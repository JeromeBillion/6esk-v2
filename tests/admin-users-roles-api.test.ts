import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  isLeadAdmin: vi.fn(),
  dbQuery: vi.fn(),
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
    query: mocks.dbQuery
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
    mocks.dbQuery
      .mockResolvedValueOnce({ rows: [{ id: ROLE_ID }] })
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
    expect(mocks.dbQuery).toHaveBeenNthCalledWith(
      4,
      expect.stringContaining("INSERT INTO mailboxes"),
      ["new@example.com", "44444444-4444-4444-4444-444444444444", TENANT_ID]
    );
    expect(mocks.dbQuery).toHaveBeenNthCalledWith(
      5,
      expect.stringContaining("WHERE address = $2 AND tenant_id = $3"),
      ["44444444-4444-4444-4444-444444444444", "new@example.com", TENANT_ID]
    );
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
    mocks.dbQuery
      .mockResolvedValueOnce({ rows: [{ id: ROLE_ID }] })
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
