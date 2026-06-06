import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  getDexterRuntimeStatus: vi.fn()
}));

vi.mock("@/server/auth/session", () => ({
  getSessionUser: mocks.getSessionUser
}));

vi.mock("@/server/dexter-runtime", () => ({
  getDexterRuntimeStatus: mocks.getDexterRuntimeStatus
}));

import { GET } from "@/app/api/admin/agents/runtime/route";

function buildUser(roleName: "lead_admin" | "agent") {
  return {
    id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    email: `${roleName}@6ex.co.za`,
    display_name: roleName,
    role_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    role_name: roleName,
    tenant_id: "00000000-0000-0000-0000-000000000001"
  };
}

describe("GET /api/admin/agents/runtime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDexterRuntimeStatus.mockReturnValue({
      state: "active",
      enabled: true,
      mode: "native",
      configuredAgentCount: 1,
      activeAgentCount: 1,
      internalDispatcherReady: true,
      startedAt: "2026-05-09T10:00:00.000Z",
      updatedAt: "2026-05-09T10:00:01.000Z",
      failureReason: null
    });
  });

  it("returns 403 for non-admin users", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser("agent"));

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toMatchObject({ error: "Forbidden" });
    expect(mocks.getDexterRuntimeStatus).not.toHaveBeenCalled();
  });

  it("returns Dexter runtime status for lead admins", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser("lead_admin"));

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      runtime: {
        state: "active",
        enabled: true,
        mode: "native",
        internalDispatcherReady: true
      }
    });
    expect(mocks.getDexterRuntimeStatus).toHaveBeenCalledTimes(1);
  });
});
