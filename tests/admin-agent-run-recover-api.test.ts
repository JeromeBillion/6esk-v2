import { beforeEach, describe, expect, it, vi } from "vitest";

const DEFAULT_TENANT_ID = "00000000-0000-0000-0000-000000000001";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  getAgentIntegrationById: vi.fn(),
  recoverStaleAgentRuns: vi.fn(),
  recordAuditLog: vi.fn()
}));

vi.mock("@/server/auth/session", () => ({
  getSessionUser: mocks.getSessionUser
}));

vi.mock("@/server/agents/integrations", () => ({
  getAgentIntegrationById: mocks.getAgentIntegrationById
}));

vi.mock("@/server/agents/run-ledger", () => ({
  DEFAULT_AGENT_APPROVAL_STALE_SECONDS: 86400,
  DEFAULT_AGENT_RUN_RECOVERY_LIMIT: 25,
  DEFAULT_AGENT_RUN_STALE_SECONDS: 900,
  MAX_STALE_AGENT_RUN_RECOVERY_LIMIT: 100,
  recoverStaleAgentRuns: mocks.recoverStaleAgentRuns
}));

vi.mock("@/server/audit", () => ({
  recordAuditLog: mocks.recordAuditLog
}));

import { POST } from "@/app/api/admin/agents/[agentId]/runs/recover/route";

function buildUser(roleName: "lead_admin" | "agent", tenantId = DEFAULT_TENANT_ID) {
  return {
    id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    email: `${roleName}@6ex.co.za`,
    display_name: roleName,
    role_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    role_name: roleName,
    tenant_id: tenantId
  };
}

describe("POST /api/admin/agents/[agentId]/runs/recover", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAgentIntegrationById.mockResolvedValue({ id: "agent-1", status: "active" });
    mocks.recoverStaleAgentRuns.mockResolvedValue({
      recovered: 2,
      retryQueued: 1,
      deadLettered: 1,
      timedOut: 1,
      lost: 1,
      runningStaleSeconds: 60,
      approvalStaleSeconds: 3600,
      limit: 10,
      runs: []
    });
    mocks.recordAuditLog.mockResolvedValue(undefined);
  });

  it("returns 403 for non-admin users", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser("agent"));

    const response = await POST(
      new Request("http://localhost/api/admin/agents/agent-1/runs/recover", { method: "POST" }),
      { params: Promise.resolve({ agentId: "agent-1" }) }
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toMatchObject({ error: "Forbidden" });
  });

  it("returns 403 for admin sessions without tenant scope", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser("lead_admin", ""));

    const response = await POST(
      new Request("http://localhost/api/admin/agents/agent-1/runs/recover", { method: "POST" }),
      { params: Promise.resolve({ agentId: "agent-1" }) }
    );

    expect(response.status).toBe(403);
    expect(mocks.getAgentIntegrationById).not.toHaveBeenCalled();
    expect(mocks.recoverStaleAgentRuns).not.toHaveBeenCalled();
  });

  it("recovers stale runs for admins and records audit evidence", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser("lead_admin"));

    const response = await POST(
      new Request(
        "http://localhost/api/admin/agents/agent-1/runs/recover?runningStaleSeconds=60&approvalStaleSeconds=3600&limit=10",
        { method: "POST" }
      ),
      { params: Promise.resolve({ agentId: "agent-1" }) }
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      status: "ok",
      recovered: 2,
      retryQueued: 1,
      deadLettered: 1
    });
    expect(mocks.recoverStaleAgentRuns).toHaveBeenCalledWith({
      tenantId: DEFAULT_TENANT_ID,
      integrationId: "agent-1",
      runningStaleSeconds: 60,
      approvalStaleSeconds: 3600,
      limit: 10
    });
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "agent_run_recovery_triggered",
        tenantId: DEFAULT_TENANT_ID,
        entityId: "agent-1"
      })
    );
  });
});
