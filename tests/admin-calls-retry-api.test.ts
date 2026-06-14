import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  retryFailedCallOutboxEvents: vi.fn(),
  recordAuditLog: vi.fn()
}));

vi.mock("@/server/auth/session", () => ({
  getSessionUser: mocks.getSessionUser
}));

vi.mock("@/server/calls/outbox", () => ({
  retryFailedCallOutboxEvents: mocks.retryFailedCallOutboxEvents
}));

vi.mock("@/server/audit", () => ({
  recordAuditLog: mocks.recordAuditLog
}));

import { POST } from "@/app/api/admin/calls/retry/route";

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

describe("POST /api/admin/calls/retry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = {
      ...ORIGINAL_ENV,
      CALLS_OUTBOX_SECRET: "calls-secret",
      TENANT_INGRESS_REQUIRE_SECRETS: "false"
    };
    mocks.retryFailedCallOutboxEvents.mockResolvedValue({
      requested: 10,
      retried: 3,
      ids: ["a", "b", "c"]
    });
    mocks.recordAuditLog.mockResolvedValue(undefined);
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("returns 401 for non-admin users without secret", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser("agent"));

    const response = await POST(new Request("http://localhost/api/admin/calls/retry", { method: "POST" }));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toMatchObject({ error: "Unauthorized" });
  });

  it("retries failed call outbox events for admins", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser("lead_admin"));

    const response = await POST(new Request("http://localhost/api/admin/calls/retry?limit=10", { method: "POST" }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ status: "ok", retried: 3 });
    expect(mocks.retryFailedCallOutboxEvents).toHaveBeenCalledWith({
      limit: 10,
      eventIds: [],
      tenantId: TENANT_ID
    });
  });

  it("returns 403 when a lead admin session has no tenant", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser("lead_admin", null));

    const response = await POST(new Request("http://localhost/api/admin/calls/retry", { method: "POST" }));

    expect(response.status).toBe(403);
    expect(mocks.retryFailedCallOutboxEvents).not.toHaveBeenCalled();
  });

  it("requires tenant header for shared-secret callers", async () => {
    mocks.getSessionUser.mockResolvedValue(null);

    const response = await POST(
      new Request("http://localhost/api/admin/calls/retry", {
        method: "POST",
        headers: { "x-6esk-secret": "calls-secret" }
      })
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toMatchObject({ error: "Tenant header is required" });
    expect(mocks.retryFailedCallOutboxEvents).not.toHaveBeenCalled();
  });

  it("returns 500 and records failure audit when retry execution throws", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser("lead_admin"));
    mocks.retryFailedCallOutboxEvents.mockRejectedValueOnce(new Error("database timeout"));

    const response = await POST(
      new Request("http://localhost/api/admin/calls/retry?limit=10", { method: "POST" })
    );
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toMatchObject({
      error: "Failed to retry failed call outbox events",
      detail: "database timeout"
    });
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "call_outbox_retry_failed"
      })
    );
  });
});
