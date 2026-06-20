import { beforeEach, describe, expect, it, vi } from "vitest";

const DEFAULT_TENANT_ID = "00000000-0000-0000-0000-000000000001";
const RUN_ID = "22222222-2222-4222-8222-222222222222";
const AGENT_ID = "11111111-1111-4111-8111-111111111111";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  getAgentIntegrationById: vi.fn(),
  listRecentAgentRuns: vi.fn()
}));

vi.mock("@/server/auth/session", () => ({
  getSessionUser: mocks.getSessionUser
}));

vi.mock("@/server/agents/integrations", () => ({
  getAgentIntegrationById: mocks.getAgentIntegrationById
}));

vi.mock("@/server/agents/run-ledger", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/agents/run-ledger")>();
  return {
    ...actual,
    listRecentAgentRuns: mocks.listRecentAgentRuns
  };
});

import { GET } from "@/app/api/admin/agents/[agentId]/runs/route";

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

function runRow(overrides: Record<string, unknown> = {}) {
  return {
    id: RUN_ID,
    tenant_id: DEFAULT_TENANT_ID,
    integration_id: AGENT_ID,
    run_type: "outbox_event",
    status: "running",
    lane_key: `tenant:${DEFAULT_TENANT_ID}:ticket:44444444-4444-4444-8444-444444444444`,
    source_channel: "ticket",
    resource_type: "ticket",
    resource_id: "44444444-4444-4444-8444-444444444444",
    trigger_event_type: "ticket.message.created",
    trigger_outbox_id: "33333333-3333-4333-8333-333333333333",
    idempotency_key: "ticket-message-1",
    rollout_mode: "full_auto",
    provider_mode: "managed",
    failure_reason: "Provider failed with api_key=secret and token=hidden",
    created_at: new Date("2026-06-20T08:00:00.000Z"),
    queued_at: new Date("2026-06-20T08:01:00.000Z"),
    started_at: new Date("2026-06-20T08:02:00.000Z"),
    completed_at: null,
    failed_at: null,
    updated_at: new Date("2026-06-20T08:03:00.000Z"),
    ...overrides
  };
}

describe("GET /api/admin/agents/[agentId]/runs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSessionUser.mockResolvedValue(buildUser("lead_admin"));
    mocks.getAgentIntegrationById.mockResolvedValue({ id: AGENT_ID, status: "active" });
    mocks.listRecentAgentRuns.mockResolvedValue([runRow()]);
  });

  it("returns 403 for non-admin users", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser("agent"));

    const response = await GET(
      new Request(`http://localhost/api/admin/agents/${AGENT_ID}/runs`),
      { params: Promise.resolve({ agentId: AGENT_ID }) }
    );

    expect(response.status).toBe(403);
    expect(mocks.getAgentIntegrationById).not.toHaveBeenCalled();
    expect(mocks.listRecentAgentRuns).not.toHaveBeenCalled();
  });

  it("returns 403 for admin sessions without tenant scope", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser("lead_admin", ""));

    const response = await GET(
      new Request(`http://localhost/api/admin/agents/${AGENT_ID}/runs`),
      { params: Promise.resolve({ agentId: AGENT_ID }) }
    );

    expect(response.status).toBe(403);
    expect(mocks.getAgentIntegrationById).not.toHaveBeenCalled();
    expect(mocks.listRecentAgentRuns).not.toHaveBeenCalled();
  });

  it("returns 404 when the agent is outside the admin tenant", async () => {
    mocks.getAgentIntegrationById.mockResolvedValue(null);

    const response = await GET(
      new Request("http://localhost/api/admin/agents/foreign-agent/runs"),
      { params: Promise.resolve({ agentId: "foreign-agent" }) }
    );

    expect(response.status).toBe(404);
    expect(mocks.listRecentAgentRuns).not.toHaveBeenCalled();
  });

  it("lists tenant-scoped runs with active filters and prompt-safe summaries", async () => {
    const response = await GET(
      new Request(`http://localhost/api/admin/agents/${AGENT_ID}/runs?activeOnly=true&limit=5`),
      { params: Promise.resolve({ agentId: AGENT_ID }) }
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.getAgentIntegrationById).toHaveBeenCalledWith(AGENT_ID, DEFAULT_TENANT_ID);
    expect(mocks.listRecentAgentRuns).toHaveBeenCalledWith({
      tenantId: DEFAULT_TENANT_ID,
      integrationId: AGENT_ID,
      statuses: ["queued", "running", "waiting_approval"],
      limit: 5
    });
    expect(body.filters).toEqual({
      limit: 5,
      statuses: ["queued", "running", "waiting_approval"]
    });
    expect(body.runs[0]).toMatchObject({
      id: RUN_ID,
      integrationId: AGENT_ID,
      status: "running",
      hasIdempotencyKey: true,
      createdAt: "2026-06-20T08:00:00.000Z",
      updatedAt: "2026-06-20T08:03:00.000Z"
    });
    expect(body.runs[0]).not.toHaveProperty("idempotencyKey");
    expect(body.runs[0].failureReason).not.toContain("secret");
    expect(body.runs[0].failureReason).not.toContain("hidden");
  });

  it("passes explicit status filters through to the run ledger", async () => {
    const response = await GET(
      new Request(`http://localhost/api/admin/agents/${AGENT_ID}/runs?status=failed,completed,unknown&limit=500`),
      { params: Promise.resolve({ agentId: AGENT_ID }) }
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.listRecentAgentRuns).toHaveBeenCalledWith({
      tenantId: DEFAULT_TENANT_ID,
      integrationId: AGENT_ID,
      statuses: ["failed", "completed"],
      limit: 100
    });
    expect(body.filters).toEqual({
      limit: 100,
      statuses: ["failed", "completed"]
    });
  });
});
