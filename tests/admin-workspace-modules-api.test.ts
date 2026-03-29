import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  getWorkspaceModules: vi.fn(),
  saveWorkspaceModules: vi.fn(),
  recordAuditLog: vi.fn()
}));

vi.mock("@/server/auth/session", () => ({
  getSessionUser: mocks.getSessionUser
}));

vi.mock("@/server/workspace-modules", () => ({
  getWorkspaceModules: mocks.getWorkspaceModules,
  saveWorkspaceModules: mocks.saveWorkspaceModules
}));

vi.mock("@/server/audit", () => ({
  recordAuditLog: mocks.recordAuditLog
}));

import { GET, POST } from "@/app/api/admin/workspace/modules/route";

function buildUser(roleName: "lead_admin" | "agent") {
  return {
    id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    email: `${roleName}@6ex.co.za`,
    display_name: roleName,
    role_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    role_name: roleName
  };
}

const CONFIG = {
  workspaceKey: "primary",
  updatedAt: "2026-03-28T12:00:00.000Z",
  modules: {
    email: true,
    whatsapp: true,
    voice: false,
    aiAutomation: true,
    venusOrchestration: false,
    vanillaWebchat: true
  }
};

describe("workspace modules admin API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getWorkspaceModules.mockResolvedValue(CONFIG);
    mocks.saveWorkspaceModules.mockResolvedValue(CONFIG);
    mocks.recordAuditLog.mockResolvedValue(undefined);
  });

  it("GET returns 403 for non-admin users", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser("agent"));

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toMatchObject({ error: "Forbidden" });
  });

  it("GET returns workspace modules for lead admins", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser("lead_admin"));

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ config: CONFIG });
  });

  it("POST persists workspace modules and records audit", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser("lead_admin"));

    const response = await POST(
      new Request("http://localhost/api/admin/workspace/modules", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(CONFIG.modules)
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ status: "updated", config: CONFIG });
    expect(mocks.saveWorkspaceModules).toHaveBeenCalledWith(CONFIG.modules);
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "workspace_modules_updated",
        entityType: "workspace_modules",
        entityId: "primary"
      })
    );
  });
});
