import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  getWorkspaceModuleUsageSummary: vi.fn()
}));

vi.mock("@/server/auth/session", () => ({
  getSessionUser: mocks.getSessionUser
}));

vi.mock("@/server/module-metering", () => ({
  getWorkspaceModuleUsageSummary: mocks.getWorkspaceModuleUsageSummary
}));

import { GET } from "@/app/api/admin/workspace/usage/route";

function buildUser(roleName: "lead_admin" | "agent") {
  return {
    id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    email: `${roleName}@6ex.co.za`,
    display_name: roleName,
    role_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    role_name: roleName
  };
}

describe("workspace usage admin API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getWorkspaceModuleUsageSummary.mockResolvedValue({
      workspaceKey: "primary",
      windowDays: 30,
      generatedAt: "2026-03-29T07:00:00.000Z",
      modules: []
    });
  });

  it("returns 403 for non-admin users", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser("agent"));

    const response = await GET(new Request("http://localhost/api/admin/workspace/usage"));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toMatchObject({ error: "Forbidden" });
  });

  it("returns usage summary for lead admins", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser("lead_admin"));

    const response = await GET(
      new Request("http://localhost/api/admin/workspace/usage?days=45")
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      summary: {
        workspaceKey: "primary",
        windowDays: 30
      }
    });
    expect(mocks.getWorkspaceModuleUsageSummary).toHaveBeenCalledWith({ windowDays: 45 });
  });
});
