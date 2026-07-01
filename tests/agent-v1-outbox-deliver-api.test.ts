import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TENANT_ID = "22222222-2222-4222-8222-222222222222";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  isLeadAdmin: vi.fn(),
  deliverPendingAgentEvents: vi.fn(),
  recordAuditLog: vi.fn(),
  runInBackground: vi.fn()
}));

vi.mock("@/server/auth/session", () => ({
  getSessionUser: mocks.getSessionUser
}));

vi.mock("@/server/auth/roles", () => ({
  isLeadAdmin: mocks.isLeadAdmin
}));

vi.mock("@/server/agents/outbox", () => ({
  deliverPendingAgentEvents: mocks.deliverPendingAgentEvents
}));

vi.mock("@/server/audit", () => ({
  recordAuditLog: mocks.recordAuditLog
}));

vi.mock("@/server/async", () => ({
  runInBackground: mocks.runInBackground
}));

import { POST } from "@/app/api/agent/v1/outbox/deliver/route";

function buildUser(roleName: "lead_admin" | "agent", tenantId: string | null = TENANT_ID) {
  return {
    id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    email: `${roleName}@6ex.co.za`,
    display_name: roleName,
    role_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    role_name: roleName,
    tenant_id: tenantId
  };
}

describe("POST /api/agent/v1/outbox/deliver", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("JOBS_RUNNER_SECRET", "jobs-maintenance-secret");
    vi.stubEnv("TENANT_INGRESS_REQUIRE_SECRETS", "false");
    mocks.isLeadAdmin.mockImplementation((user) => user?.role_name === "lead_admin");
    mocks.deliverPendingAgentEvents.mockResolvedValue({
      delivered: 2,
      skipped: 0,
      limitUsed: 5
    });
    mocks.recordAuditLog.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("requires a tenant header for shared-secret callers", async () => {
    mocks.getSessionUser.mockResolvedValue(null);

    const response = await POST(
      new Request("http://localhost/api/agent/v1/outbox/deliver", {
        method: "POST",
        headers: { "x-6esk-secret": "jobs-maintenance-secret" }
      })
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toMatchObject({ error: "Tenant header is required" });
    expect(mocks.deliverPendingAgentEvents).not.toHaveBeenCalled();
  });

  it("delivers agent outbox events under the explicit machine tenant", async () => {
    mocks.getSessionUser.mockResolvedValue(null);

    const response = await POST(
      new Request("http://localhost/api/agent/v1/outbox/deliver?limit=7", {
        method: "POST",
        headers: {
          "x-6esk-secret": "jobs-maintenance-secret",
          "x-6esk-tenant-id": TENANT_ID
        }
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ status: "ok", delivered: 2, skipped: 0, limitUsed: 5 });
    expect(mocks.deliverPendingAgentEvents).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      limit: 7
    });
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT_ID,
        actorUserId: null,
        action: "agent_outbox_delivery_triggered",
        data: expect.objectContaining({ authMode: "shared_secret", delivered: 2 })
      })
    );
  });

  it("delivers agent outbox events under the lead admin session tenant", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser("lead_admin"));

    const response = await POST(
      new Request("http://localhost/api/agent/v1/outbox/deliver?limit=9", {
        method: "POST"
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.deliverPendingAgentEvents).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      limit: 9
    });
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT_ID,
        actorUserId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        data: expect.objectContaining({ authMode: "session" })
      })
    );
  });

  it("returns module_disabled when tenant AI Automation is disabled", async () => {
    mocks.getSessionUser.mockResolvedValue(null);
    const error = new Error("AI Automation module is not enabled for this tenant.");
    error.name = "AgentOutboxModuleDisabledError";
    mocks.deliverPendingAgentEvents.mockRejectedValueOnce(error);

    const response = await POST(
      new Request("http://localhost/api/agent/v1/outbox/deliver?limit=7", {
        method: "POST",
        headers: {
          "x-6esk-secret": "jobs-maintenance-secret",
          "x-6esk-tenant-id": TENANT_ID
        }
      })
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toMatchObject({
      code: "module_disabled",
      module: "aiAutomation"
    });
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT_ID,
        action: "agent_outbox_delivery_blocked",
        data: expect.objectContaining({
          code: "module_disabled",
          module: "aiAutomation"
        })
      })
    );
    expect(mocks.runInBackground).not.toHaveBeenCalled();
  });

  it("returns 403 when a lead admin session has no tenant", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser("lead_admin", null));

    const response = await POST(
      new Request("http://localhost/api/agent/v1/outbox/deliver", {
        method: "POST"
      })
    );

    expect(response.status).toBe(403);
    expect(mocks.deliverPendingAgentEvents).not.toHaveBeenCalled();
  });
});
