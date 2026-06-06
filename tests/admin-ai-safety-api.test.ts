import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  getAiSafetyDiagnostics: vi.fn()
}));

vi.mock("@/server/auth/session", () => ({
  getSessionUser: mocks.getSessionUser
}));

vi.mock("@/server/auth/roles", () => ({
  isLeadAdmin: (user: { role_name?: string | null } | null) => user?.role_name === "lead_admin"
}));

vi.mock("@/server/ai/safety-diagnostics", () => ({
  getAiSafetyDiagnostics: mocks.getAiSafetyDiagnostics
}));

import { GET } from "@/app/api/admin/ai/safety/route";

function buildUser(roleName: "lead_admin" | "agent") {
  return {
    id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    email: `${roleName}@6ex.co.za`,
    display_name: roleName,
    role_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    role_name: roleName,
    tenant_key: "tenant-a",
    workspace_key: "workspace-a"
  };
}

describe("GET /api/admin/ai/safety", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSessionUser.mockResolvedValue(buildUser("lead_admin"));
    mocks.getAiSafetyDiagnostics.mockResolvedValue({
      summary: {
        guardEvents: 1,
        maliciousGuardEvents: 1,
        suspiciousGuardEvents: 0,
        blockedPolicyDecisions: 1,
        reviewPolicyDecisions: 0,
        readOnlyPolicyDecisions: 0
      },
      guardEvents: [{ id: "guard-1", severity: "malicious" }],
      policyDecisions: [{ id: "decision-1", decision: "block" }]
    });
  });

  it("blocks non-admin access", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser("agent"));

    const response = await GET(new Request("http://localhost/api/admin/ai/safety"));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toMatchObject({ error: "Forbidden" });
  });

  it("returns tenant-scoped safety diagnostics for lead admins", async () => {
    const response = await GET(new Request("http://localhost/api/admin/ai/safety?limit=25"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.summary.blockedPolicyDecisions).toBe(1);
    expect(mocks.getAiSafetyDiagnostics).toHaveBeenCalledWith(
      {
        tenantKey: "tenant-a",
        workspaceKey: "workspace-a"
      },
      { limit: 25 }
    );
  });
});
