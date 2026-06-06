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
          expires_at: new Date(Date.now() + 60_000).toISOString(),
          used_at: null
        }
      ]
    });
    mocks.clientQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
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
    expect(mocks.clientQuery).toHaveBeenCalledWith("DELETE FROM auth_sessions WHERE user_id = $1", [
      "user-1"
    ]);
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "password_reset_completed",
        data: { revokedSessionCount: 2 }
      })
    );
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "password_reset_sessions_revoked",
        data: { revokedSessionCount: 2 }
      })
    );
  });
});
