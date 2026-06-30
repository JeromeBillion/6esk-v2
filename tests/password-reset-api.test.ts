import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dbQuery: vi.fn(),
  clientQuery: vi.fn(),
  clientRelease: vi.fn(),
  hashPassword: vi.fn(),
  recordAuditLog: vi.fn()
}));

vi.mock("@/server/db", () => ({
  db: {
    query: mocks.dbQuery,
    connect: vi.fn(() =>
      Promise.resolve({
        query: mocks.clientQuery,
        release: mocks.clientRelease
      })
    )
  }
}));

vi.mock("@/server/auth/password", () => ({
  hashPassword: mocks.hashPassword
}));

vi.mock("@/server/audit", () => ({
  recordAuditLog: mocks.recordAuditLog
}));

const ORIGINAL_ENV = { ...process.env };

describe("POST /api/auth/password-reset", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env = { ...ORIGINAL_ENV };
    mocks.hashPassword.mockReturnValue("hashed-password");
    mocks.recordAuditLog.mockResolvedValue(undefined);
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("updates the password, marks the token used, revokes active sessions, and audits revocation", async () => {
    mocks.dbQuery.mockResolvedValueOnce({
      rows: [
        {
          id: "reset-1",
          user_id: "user-1",
          tenant_id: "tenant-1",
          expires_at: new Date(Date.now() + 60_000).toISOString(),
          used_at: null
        }
      ]
    });
    mocks.clientQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "reset-1",
            user_id: "user-1",
            tenant_id: "tenant-1",
            expires_at: new Date(Date.now() + 60_000).toISOString(),
            used_at: null
          }
        ]
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rowCount: 2 })
      .mockResolvedValueOnce({ rows: [] });

    const { POST } = await import("@/app/api/auth/password-reset/route");
    const response = await POST(
      new Request("https://desk.example.com/api/auth/password-reset", {
        method: "POST",
        body: JSON.stringify({
          token: "reset-token-123",
          password: "new-password"
        })
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.dbQuery).toHaveBeenCalledWith(
      expect.stringContaining("SELECT pr.id, pr.user_id, pr.tenant_id"),
      [expect.any(String)]
    );
    expect(mocks.clientQuery).toHaveBeenCalledWith(expect.stringContaining("revoke_reason = 'password_reset'"), [
      "user-1",
      "tenant-1"
    ]);
    expect(mocks.clientQuery).toHaveBeenCalledWith(expect.stringContaining("FOR UPDATE"), ["reset-1", "tenant-1"]);
    expect(mocks.clientQuery).toHaveBeenCalledWith(
      expect.stringContaining("AND used_at IS NULL"),
      ["reset-1", "tenant-1"]
    );
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        action: "password_reset_completed",
        data: { revokedSessionCount: 2 }
      })
    );
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        action: "password_reset_sessions_revoked",
        data: { revokedSessionCount: 2 }
      })
    );
  });

  it("rejects reset token reuse when another request consumes the row first", async () => {
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    mocks.dbQuery.mockResolvedValueOnce({
      rows: [
        {
          id: "reset-1",
          user_id: "user-1",
          tenant_id: "tenant-1",
          expires_at: expiresAt,
          used_at: null
        }
      ]
    });
    mocks.clientQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "reset-1",
            user_id: "user-1",
            tenant_id: "tenant-1",
            expires_at: expiresAt,
            used_at: new Date().toISOString()
          }
        ]
      })
      .mockResolvedValueOnce({ rows: [] });

    const { POST } = await import("@/app/api/auth/password-reset/route");
    const response = await POST(
      new Request("https://desk.example.com/api/auth/password-reset", {
        method: "POST",
        body: JSON.stringify({
          token: "reset-token-123",
          password: "new-password"
        })
      })
    );

    await expect(response.json()).resolves.toMatchObject({ error: "Token already used" });
    expect(response.status).toBe(400);
    expect(mocks.clientQuery).toHaveBeenCalledWith(expect.stringContaining("FOR UPDATE"), ["reset-1", "tenant-1"]);
    expect(mocks.clientQuery).toHaveBeenCalledWith("ROLLBACK");
    expect(mocks.clientQuery).not.toHaveBeenCalledWith(expect.stringContaining("UPDATE users"), expect.any(Array));
    expect(mocks.recordAuditLog).not.toHaveBeenCalled();
  });
});
