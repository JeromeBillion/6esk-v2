import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  dbQuery: vi.fn(),
  getEnv: vi.fn(),
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

vi.mock("@/server/env", () => ({
  getEnv: mocks.getEnv
}));

vi.mock("@/server/audit", () => ({
  recordAuditLog: mocks.recordAuditLog
}));

import { POST as CREATE_RESET } from "@/app/api/admin/users/[userId]/password-reset/route";
import { PATCH } from "@/app/api/admin/users/[userId]/route";

function buildUser(roleName: "lead_admin" | "agent") {
  return {
    id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    email: `${roleName}@example.test`,
    display_name: roleName,
    role_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    role_name: roleName,
    tenant_key: "tenant-users",
    workspace_key: "workspace-users"
  };
}

describe("admin users API tenant scope", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSessionUser.mockResolvedValue(buildUser("lead_admin"));
    mocks.getEnv.mockReturnValue({ APP_URL: "https://app.example.test" });
  });

  it("scopes user updates to the admin workspace", async () => {
    mocks.dbQuery
      .mockResolvedValueOnce({
        rows: [
          {
            id: "target-user",
            email: "target@example.test",
            role_id: "role-1",
            is_active: true
          }
        ]
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "target-user",
            email: "target@example.test",
            display_name: "Target User",
            role_id: "role-1",
            is_active: false,
            created_at: "2026-01-01T00:00:00.000Z"
          }
        ]
      });

    const response = await PATCH(
      new Request("http://localhost/api/admin/users/target-user", {
        method: "PATCH",
        body: JSON.stringify({ isActive: false })
      }),
      { params: Promise.resolve({ userId: "target-user" }) }
    );

    expect(response.status).toBe(200);
    expect(mocks.dbQuery).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("AND workspace_key = $3"),
      ["target-user", "tenant-users", "workspace-users"]
    );
    expect(mocks.dbQuery).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("AND workspace_key = $4"),
      [false, "target-user", "tenant-users", "workspace-users"]
    );
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantKey: "tenant-users",
        workspaceKey: "workspace-users",
        action: "user_updated",
        entityId: "target-user"
      })
    );
  });

  it("creates password reset tokens only for users in the admin workspace", async () => {
    mocks.dbQuery
      .mockResolvedValueOnce({
        rows: [
          {
            id: "target-user",
            email: "target@example.test",
            tenant_key: "tenant-users",
            workspace_key: "workspace-users"
          }
        ]
      })
      .mockResolvedValueOnce({ rows: [] });

    const response = await CREATE_RESET(
      new Request("http://localhost/api/admin/users/target-user/password-reset", {
        method: "POST"
      }),
      { params: Promise.resolve({ userId: "target-user" }) }
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.resetLink).toMatch(/^https:\/\/app\.example\.test\/reset-password\?token=/);
    expect(mocks.dbQuery).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("AND workspace_key = $3"),
      ["target-user", "tenant-users", "workspace-users"]
    );
    expect(mocks.dbQuery).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining(
        "INSERT INTO password_resets (tenant_key, workspace_key, user_id, token_hash, expires_at)"
      ),
      ["tenant-users", "workspace-users", "target-user", expect.any(String), expect.any(Date)]
    );
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantKey: "tenant-users",
        workspaceKey: "workspace-users",
        action: "password_reset_requested",
        entityId: "target-user"
      })
    );
  });
});
