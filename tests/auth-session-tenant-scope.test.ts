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

import { clearSession, getSessionUser } from "@/server/auth/session";

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
  });
});
