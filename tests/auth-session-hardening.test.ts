import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dbQuery: vi.fn(),
  cookieGet: vi.fn(),
  cookieSet: vi.fn()
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: mocks.cookieGet,
    set: mocks.cookieSet
  }))
}));

vi.mock("@/server/db", () => ({
  db: {
    query: mocks.dbQuery
  }
}));

describe("auth session hardening", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SESSION_SECRET = "session-secret-long-enough";
    process.env.SESSION_TTL_DAYS = "14";
  });

  it("creates sessions with auth provider, tenant policy TTL, and device fingerprints", async () => {
    const { createSession } = await import("@/server/auth/session");
    mocks.dbQuery
      .mockResolvedValueOnce({
        rows: [{ tenant_id: "tenant-1", session_ttl_days: 7 }]
      })
      .mockResolvedValueOnce({ rows: [] });

    await createSession("user-1", {
      authProvider: "password_mfa",
      requestHeaders: new Headers({
        "user-agent": "Vitest",
        "x-forwarded-for": "203.0.113.10, 10.0.0.1"
      })
    });

    expect(mocks.dbQuery).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("tenant_security_policies"),
      ["user-1"]
    );
    expect(mocks.dbQuery).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("auth_provider"),
      expect.arrayContaining(["user-1", expect.any(String), expect.any(Date), "password_mfa"])
    );
    const insertParams = mocks.dbQuery.mock.calls[1][1];
    expect(insertParams[4]).toEqual(expect.any(String));
    expect(insertParams[5]).toEqual(expect.any(String));
    expect(mocks.cookieSet).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.objectContaining({ httpOnly: true, sameSite: "lax" })
    );
  });

  it("revokes the current session instead of deleting it on logout", async () => {
    const { clearSession } = await import("@/server/auth/session");
    mocks.cookieGet.mockReturnValue({ value: "raw-session-token" });
    mocks.dbQuery.mockResolvedValueOnce({ rowCount: 1, rows: [] });

    await clearSession();

    expect(mocks.dbQuery).toHaveBeenCalledWith(expect.stringContaining("revoked_at = now()"), [
      expect.any(String)
    ]);
    expect(mocks.cookieSet).toHaveBeenCalledWith(
      expect.any(String),
      "",
      expect.objectContaining({ expires: expect.any(Date) })
    );
  });

  it("lists user sessions against the home tenant during impersonation", async () => {
    const { listUserSessions } = await import("@/server/auth/session");
    mocks.dbQuery.mockResolvedValueOnce({ rows: [] });

    await listUserSessions({
      id: "support-user",
      tenant_id: "tenant-target",
      real_tenant_id: "tenant-home"
    });

    expect(mocks.dbQuery).toHaveBeenCalledWith(expect.stringContaining("auth_sessions"), [
      "support-user",
      "tenant-home"
    ]);
  });
});
