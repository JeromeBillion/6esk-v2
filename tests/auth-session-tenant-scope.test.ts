import fs from "fs";
import path from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { scanFileContent } from "../scripts/tenant-query-scope-sweep.js";

const mocks = vi.hoisted(() => ({
  cookies: vi.fn(),
  cookieGet: vi.fn(),
  cookieSet: vi.fn(),
  dbQuery: vi.fn()
}));

vi.mock("next/headers", () => ({
  cookies: mocks.cookies
}));

vi.mock("@/server/db", () => ({
  db: {
    query: mocks.dbQuery
  }
}));

import {
  clearSession,
  createSession,
  getSessionUser,
  listUserSessions,
  revokeSessionForUser,
  revokeUserSessions
} from "@/server/auth/session";

describe("auth session tenant scope", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.cookies.mockResolvedValue({
      get: mocks.cookieGet,
      set: mocks.cookieSet
    });
    mocks.cookieGet.mockReturnValue({ value: "session-token" });
    mocks.dbQuery.mockResolvedValue({ rows: [] });
  });

  it("keeps auth session SQL tenant-scoped", () => {
    const relativePath = "src/server/auth/session.ts";
    const source = fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
    const result = scanFileContent(relativePath, source);

    expect(result.findings).toEqual([]);
  });

  it("clears only the session row under the token's stored tenant workspace", async () => {
    await clearSession();

    expect(mocks.dbQuery).toHaveBeenCalledWith(
      expect.stringContaining("DELETE FROM auth_sessions s"),
      [expect.any(String)]
    );
    expect(mocks.dbQuery).toHaveBeenCalledWith(
      expect.stringContaining("AND s.tenant_key = current_session.tenant_key"),
      [expect.any(String)]
    );
    expect(mocks.dbQuery).toHaveBeenCalledWith(
      expect.stringContaining("AND s.workspace_key = current_session.workspace_key"),
      [expect.any(String)]
    );
    expect(mocks.cookieSet).toHaveBeenCalledWith(
      "sixesk_session",
      "",
      expect.objectContaining({ expires: expect.any(Date), path: "/" })
    );
  });

  it("requires the stored session workspace to match the active user workspace", async () => {
    mocks.dbQuery.mockResolvedValueOnce({
      rows: [
        {
          session_id: "session-1",
          id: "user-1",
          email: "user@example.test",
          display_name: "User",
          role_id: null,
          role_name: null,
          tenant_key: "tenant-auth",
          workspace_key: "workspace-auth"
        }
      ]
    });

    const user = await getSessionUser();

    expect(user).toMatchObject({
      id: "user-1",
      tenant_key: "tenant-auth",
      workspace_key: "workspace-auth"
    });
    expect(mocks.dbQuery).toHaveBeenCalledWith(
      expect.stringContaining("AND s.workspace_key = u.workspace_key"),
      [expect.any(String)]
    );
    expect(mocks.dbQuery).toHaveBeenCalledWith(
      expect.stringContaining("AND s.revoked_at IS NULL"),
      [expect.any(String)]
    );
    expect(mocks.dbQuery).toHaveBeenCalledWith(
      expect.stringContaining("SET last_seen_at = now()"),
      ["session-1", "tenant-auth", "workspace-auth"]
    );
  });

  it("records auth provider and hashed device fingerprints when creating a session", async () => {
    mocks.dbQuery
      .mockResolvedValueOnce({
        rows: [{ tenant_key: "tenant-auth", workspace_key: "workspace-auth" }]
      })
      .mockResolvedValueOnce({ rows: [] });

    await createSession("user-1", {
      authProvider: "better_auth",
      requestHeaders: new Headers({
        "user-agent": "Vitest",
        "x-forwarded-for": "203.0.113.10"
      })
    });

    expect(mocks.dbQuery).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("auth_provider"),
      [
        "tenant-auth",
        "workspace-auth",
        "user-1",
        expect.any(String),
        expect.any(Date),
        "better_auth",
        expect.any(String),
        expect.any(String)
      ]
    );
    expect(mocks.cookieSet).toHaveBeenCalledWith(
      "sixesk_session",
      expect.any(String),
      expect.objectContaining({ httpOnly: true, sameSite: "lax" })
    );
  });

  it("revokes active sessions only inside the target tenant workspace", async () => {
    mocks.dbQuery.mockResolvedValueOnce({ rowCount: 3, rows: [] });

    const revoked = await revokeUserSessions({
      userId: "user-1",
      tenantKey: "tenant-auth",
      workspaceKey: "workspace-auth",
      reason: "password_reset"
    });

    expect(revoked).toBe(3);
    expect(mocks.dbQuery).toHaveBeenCalledWith(
      expect.stringContaining("SET revoked_at = now()"),
      ["user-1", "tenant-auth", "workspace-auth", "password_reset"]
    );
    expect(mocks.dbQuery).toHaveBeenCalledWith(
      expect.stringContaining("AND workspace_key = $3"),
      ["user-1", "tenant-auth", "workspace-auth", "password_reset"]
    );
  });

  it("lists sessions only inside the current user's tenant workspace", async () => {
    const user = {
      id: "user-1",
      email: "user@example.test",
      display_name: "User",
      role_id: null,
      role_name: null,
      tenant_key: "tenant-auth",
      workspace_key: "workspace-auth"
    };
    mocks.dbQuery.mockResolvedValueOnce({
      rows: [
        {
          id: "session-1",
          auth_provider: "password",
          created_at: "2026-06-02T10:00:00.000Z",
          last_seen_at: null,
          expires_at: "2026-06-16T10:00:00.000Z",
          revoked_at: null,
          revoke_reason: null,
          has_device_fingerprint: true
        }
      ]
    });

    await expect(listUserSessions(user)).resolves.toHaveLength(1);
    expect(mocks.dbQuery).toHaveBeenCalledWith(
      expect.stringContaining("AND workspace_key = $3"),
      ["user-1", "tenant-auth", "workspace-auth"]
    );
  });

  it("revokes a single user session only inside the current tenant workspace", async () => {
    const user = {
      id: "user-1",
      email: "user@example.test",
      display_name: "User",
      role_id: null,
      role_name: null,
      tenant_key: "tenant-auth",
      workspace_key: "workspace-auth"
    };
    mocks.dbQuery.mockResolvedValueOnce({ rowCount: 1, rows: [] });

    await expect(
      revokeSessionForUser({
        sessionId: "session-1",
        user,
        reason: "user_revoked"
      })
    ).resolves.toBe(true);
    expect(mocks.dbQuery).toHaveBeenCalledWith(
      expect.stringContaining("AND workspace_key = $4"),
      ["session-1", "user-1", "tenant-auth", "workspace-auth", "user_revoked"]
    );
  });
});
