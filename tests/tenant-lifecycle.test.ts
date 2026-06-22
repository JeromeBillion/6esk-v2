import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dbQuery: vi.fn(),
  dbConnect: vi.fn(),
  recordAuditLogWithClient: vi.fn()
}));

vi.mock("@/server/db", () => ({
  db: {
    query: mocks.dbQuery,
    connect: mocks.dbConnect
  }
}));

vi.mock("@/server/audit", () => ({
  recordAuditLogWithClient: mocks.recordAuditLogWithClient
}));

const TENANT_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const ACTOR_ID = "11111111-1111-1111-1111-111111111111";

function tenantRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: TENANT_ID,
    slug: "acme",
    display_name: "Acme",
    status: "active",
    plan: "standard",
    settings: {},
    created_at: "2026-05-17T00:00:00.000Z",
    updated_at: "2026-05-17T00:00:00.000Z",
    ...overrides
  };
}

function mockClient() {
  return {
    query: vi.fn(),
    release: vi.fn()
  };
}

describe("tenant lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.recordAuditLogWithClient.mockResolvedValue(undefined);
  });

  it("fails runtime usage for suspended tenants", async () => {
    const { assertTenantRuntimeActive } = await import("@/server/tenant/lifecycle");
    mocks.dbQuery.mockResolvedValueOnce({
      rows: [tenantRow({ status: "suspended" })]
    });

    await expect(assertTenantRuntimeActive(TENANT_ID)).rejects.toMatchObject({
      code: "TENANT_SUSPENDED",
      status: 403
    });
  });

  it("suspends tenants with lifecycle metadata and audit", async () => {
    const { suspendTenant } = await import("@/server/tenant/lifecycle");
    const client = mockClient();
    mocks.dbConnect.mockResolvedValueOnce(client);
    client.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [tenantRow()] })
      .mockResolvedValueOnce({ rows: [tenantRow({ status: "suspended" })] })
      .mockResolvedValueOnce({ rows: [] });

    const tenant = await suspendTenant(TENANT_ID, "billing overdue", ACTOR_ID);

    expect(tenant.status).toBe("suspended");
    expect(client.query).toHaveBeenNthCalledWith(1, "BEGIN");
    expect(client.query).toHaveBeenNthCalledWith(4, "COMMIT");
    const updateCall = client.query.mock.calls[2];
    const settings = JSON.parse(updateCall[1][2] as string);
    expect(settings.lifecycle).toMatchObject({
      status: "suspended",
      lastAction: "tenant_suspended",
      lastReason: "billing overdue",
      lastActorUserId: ACTOR_ID
    });
    expect(mocks.recordAuditLogWithClient).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        tenantId: TENANT_ID,
        actorUserId: ACTOR_ID,
        action: "tenant_suspended",
        entityType: "tenant",
        entityId: TENANT_ID,
        data: expect.objectContaining({
          reason: "billing overdue",
          previousStatus: "active",
          status: "suspended"
        })
      })
    );
    expect(client.release).toHaveBeenCalled();
  });

  it("keeps closed tenants terminal", async () => {
    const { reactivateTenant } = await import("@/server/tenant/lifecycle");
    const client = mockClient();
    mocks.dbConnect.mockResolvedValueOnce(client);
    client.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [tenantRow({ status: "closed" })] })
      .mockResolvedValueOnce({ rows: [] });

    await expect(reactivateTenant(TENANT_ID, ACTOR_ID)).rejects.toMatchObject({
      code: "TENANT_CLOSED",
      status: 409
    });

    expect(client.query).toHaveBeenNthCalledWith(3, "ROLLBACK");
    expect(mocks.recordAuditLogWithClient).not.toHaveBeenCalled();
    expect(client.release).toHaveBeenCalled();
  });

  it("changes plan without mutating entitlements", async () => {
    const { changeTenantPlan } = await import("@/server/tenant/lifecycle");
    const client = mockClient();
    mocks.dbConnect.mockResolvedValueOnce(client);
    client.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [tenantRow({ plan: "standard" })] })
      .mockResolvedValueOnce({ rows: [tenantRow({ plan: "enterprise" })] })
      .mockResolvedValueOnce({ rows: [] });

    const tenant = await changeTenantPlan({
      tenantId: TENANT_ID,
      plan: "enterprise",
      reason: "contract upgrade",
      actorUserId: ACTOR_ID
    });

    expect(tenant.plan).toBe("enterprise");
    expect(client.query.mock.calls[2][0]).toContain("SET plan = $2");
    expect(mocks.recordAuditLogWithClient).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        action: "tenant_plan_changed",
        data: expect.objectContaining({
          previousPlan: "standard",
          plan: "enterprise"
        })
      })
    );
  });
});
