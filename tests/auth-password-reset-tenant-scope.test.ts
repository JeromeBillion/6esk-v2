import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dbQuery: vi.fn(),
  hashPassword: vi.fn(),
  recordAuditLog: vi.fn()
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

import { POST } from "@/app/api/auth/password-reset/route";

describe("POST /api/auth/password-reset tenant scope", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hashPassword.mockReturnValue("hashed-password");
  });

  it("updates the password and consumes the reset token inside the stored tenant scope", async () => {
    mocks.dbQuery
      .mockResolvedValueOnce({
        rows: [
          {
            id: "reset-1",
            user_id: "target-user",
            expires_at: new Date(Date.now() + 60_000).toISOString(),
            used_at: null,
            tenant_key: "tenant-users",
            workspace_key: "workspace-users"
          }
        ]
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rowCount: 2, rows: [] });

    const response = await POST(
      new Request("http://localhost/api/auth/password-reset", {
        method: "POST",
        body: JSON.stringify({ token: "reset-token-123", password: "new-password" })
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "updated",
      revokedSessionCount: 2
    });
    expect(mocks.dbQuery).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("JOIN users u"),
      [expect.any(String)]
    );
    expect(mocks.dbQuery).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("AND u.workspace_key = pr.workspace_key"),
      [expect.any(String)]
    );
    expect(mocks.dbQuery).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("AND workspace_key = $4"),
      ["hashed-password", "target-user", "tenant-users", "workspace-users"]
    );
    expect(mocks.dbQuery).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining("AND workspace_key = $3"),
      ["reset-1", "tenant-users", "workspace-users"]
    );
    expect(mocks.dbQuery).toHaveBeenNthCalledWith(
      4,
      expect.stringContaining("SET revoked_at = now()"),
      ["target-user", "tenant-users", "workspace-users", "password_reset"]
    );
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantKey: "tenant-users",
        workspaceKey: "workspace-users",
        action: "password_reset_completed",
        entityId: "target-user",
        data: { revokedSessionCount: 2 }
      })
    );
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantKey: "tenant-users",
        workspaceKey: "workspace-users",
        action: "auth_sessions_revoked",
        entityId: "target-user",
        data: { reason: "password_reset", revokedSessionCount: 2 }
      })
    );
  });
});
