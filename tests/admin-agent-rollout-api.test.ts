import { beforeEach, describe, expect, it, vi } from "vitest";

const TENANT_ID = "00000000-0000-0000-0000-000000000001";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  getAgentIntegrationById: vi.fn(),
  updateAgentIntegration: vi.fn(),
  recordAuditLog: vi.fn()
}));

vi.mock("@/server/auth/session", () => ({
  getSessionUser: mocks.getSessionUser
}));

vi.mock("@/server/agents/integrations", () => ({
  getAgentIntegrationById: mocks.getAgentIntegrationById,
  updateAgentIntegration: mocks.updateAgentIntegration
}));

vi.mock("@/server/audit", () => ({
  recordAuditLog: mocks.recordAuditLog
}));

import {
  GET,
  PATCH
} from "@/app/api/admin/agents/[agentId]/rollout/route";

function buildUser(roleName: "lead_admin" | "agent") {
  return {
    id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    email: `${roleName}@6ex.co.za`,
    display_name: roleName,
    role_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    role_name: roleName,
    tenant_id: TENANT_ID
  };
}

function buildAgent(overrides: Record<string, unknown> = {}) {
  return {
    id: "agent-1",
    tenant_id: TENANT_ID,
    name: "Dexter",
    status: "active",
    policy: {
      dryRun: true,
      allowed_auto_actions: ["send_reply"],
      escalation: { out_of_hours: "draft_only" }
    },
    capabilities: {
      max_actions_per_minute: 5,
      allowVoiceActions: true
    },
    ...overrides
  };
}

function request(body: Record<string, unknown>) {
  return new Request("http://localhost/api/admin/agents/agent-1/rollout", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}

describe("admin agent rollout controls API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSessionUser.mockResolvedValue(buildUser("lead_admin"));
    mocks.getAgentIntegrationById.mockResolvedValue(buildAgent());
    mocks.updateAgentIntegration.mockImplementation(async (_id, updates) =>
      buildAgent({
        policy: updates.policy,
        capabilities: updates.capabilities
      })
    );
    mocks.recordAuditLog.mockResolvedValue(undefined);
  });

  it("returns 403 for non-admin users", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser("agent"));

    const response = await GET(new Request("http://localhost/api/admin/agents/agent-1/rollout"), {
      params: Promise.resolve({ agentId: "agent-1" })
    });

    expect(response.status).toBe(403);
    expect(mocks.getAgentIntegrationById).not.toHaveBeenCalled();
  });

  it("returns canonical rollout controls without exposing agent secrets", async () => {
    mocks.getAgentIntegrationById.mockResolvedValue(
      buildAgent({
        shared_secret: "super-secret",
        policy: {
          actionRolloutMode: "limited_auto",
          allowedAutoActions: ["send_reply", "set_priority"]
        },
        capabilities: { maxActionsPerMinute: 12 }
      })
    );

    const response = await GET(new Request("http://localhost/api/admin/agents/agent-1/rollout"), {
      params: Promise.resolve({ agentId: "agent-1" })
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      agentId: "agent-1",
      tenantId: TENANT_ID,
      rollout: {
        actionRolloutMode: "limited_auto",
        allowedAutoActions: ["send_reply", "set_priority"],
        maxActionsPerMinute: 12
      }
    });
    expect(JSON.stringify(body)).not.toContain("super-secret");
    expect(mocks.getAgentIntegrationById).toHaveBeenCalledWith("agent-1", TENANT_ID);
  });

  it("rejects invalid rollout controls", async () => {
    const response = await PATCH(request({ actionRolloutMode: "full_send" }), {
      params: Promise.resolve({ agentId: "agent-1" })
    });

    expect(response.status).toBe(400);
    expect(mocks.updateAgentIntegration).not.toHaveBeenCalled();
  });

  it("writes canonical rollout policy and strips stale aliases", async () => {
    const response = await PATCH(
      request({
        actionRolloutMode: "limited_auto",
        allowedAutoActions: ["send_reply", "send_reply", "set_priority"],
        maxActionsPerMinute: 20
      }),
      { params: Promise.resolve({ agentId: "agent-1" }) }
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      status: "updated",
      rollout: {
        actionRolloutMode: "limited_auto",
        allowedAutoActions: ["send_reply", "set_priority"],
        maxActionsPerMinute: 20
      }
    });

    expect(mocks.getAgentIntegrationById).toHaveBeenCalledWith("agent-1", TENANT_ID);
    expect(mocks.updateAgentIntegration).toHaveBeenCalledWith(
      "agent-1",
      {
        policy: {
          escalation: { out_of_hours: "draft_only" },
          actionRolloutMode: "limited_auto",
          allowedAutoActions: ["send_reply", "set_priority"]
        },
        capabilities: {
          allowVoiceActions: true,
          maxActionsPerMinute: 20
        }
      },
      TENANT_ID
    );
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "agent_rollout_controls_updated",
        entityId: "agent-1",
        data: expect.objectContaining({
          previous: expect.objectContaining({ actionRolloutMode: "dry_run" }),
          next: expect.objectContaining({ actionRolloutMode: "limited_auto" })
        })
      })
    );
  });

  it("returns 404 when the agent is outside the admin tenant", async () => {
    mocks.getAgentIntegrationById.mockResolvedValue(null);

    const response = await PATCH(request({ actionRolloutMode: "dry_run" }), {
      params: Promise.resolve({ agentId: "foreign-agent" })
    });

    expect(response.status).toBe(404);
    expect(mocks.updateAgentIntegration).not.toHaveBeenCalled();
  });
});
