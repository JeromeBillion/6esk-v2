import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  listFailedCallOutboxEvents: vi.fn()
}));

vi.mock("@/server/auth/session", () => ({
  getSessionUser: mocks.getSessionUser
}));

vi.mock("@/server/calls/outbox", () => ({
  listFailedCallOutboxEvents: mocks.listFailedCallOutboxEvents
}));

import { GET } from "@/app/api/admin/calls/failed/route";

const ORIGINAL_ENV = { ...process.env };
const TENANT_ID = "22222222-2222-4222-8222-222222222222";

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

describe("GET /api/admin/calls/failed", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = {
      ...ORIGINAL_ENV,
      CALLS_OUTBOX_SECRET: "calls-secret",
      TENANT_INGRESS_REQUIRE_SECRETS: "false"
    };
    mocks.listFailedCallOutboxEvents.mockResolvedValue([
      {
        id: "evt-1",
        status: "failed",
        attempt_count: 5,
        last_error: "provider timeout to +15551234567",
        payload: {
          toPhone: "+15551234567",
          fromPhone: "+15557654321"
        }
      }
    ]);
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("returns 403 for non-admin users", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser("agent"));

    const response = await GET(new Request("http://localhost/api/admin/calls/failed"));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toMatchObject({ error: "Forbidden" });
  });

  it("returns failed call outbox events for admins", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser("lead_admin"));

    const response = await GET(new Request("http://localhost/api/admin/calls/failed?limit=25"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.events).toHaveLength(1);
    expect(body.events[0]).toMatchObject({
      last_error: "provider timeout to +1555******67",
      payload: {
        toPhone: "+1555******67",
        fromPhone: "+1555******21"
      }
    });
    expect(mocks.listFailedCallOutboxEvents).toHaveBeenCalledWith(25, TENANT_ID);
  });

  it("returns 403 when a lead admin session has no tenant", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser("lead_admin", null));

    const response = await GET(new Request("http://localhost/api/admin/calls/failed?limit=25"));

    expect(response.status).toBe(403);
    expect(mocks.listFailedCallOutboxEvents).not.toHaveBeenCalled();
  });

  it("returns failed call outbox events for shared-secret callers with explicit tenant", async () => {
    mocks.getSessionUser.mockResolvedValue(null);

    const response = await GET(
      new Request("http://localhost/api/admin/calls/failed?limit=25", {
        headers: {
          "x-6esk-secret": "calls-secret",
          "x-6esk-tenant-id": TENANT_ID
        }
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.listFailedCallOutboxEvents).toHaveBeenCalledWith(25, TENANT_ID);
  });
});
