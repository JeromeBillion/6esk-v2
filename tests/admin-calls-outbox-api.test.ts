import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  deliverPendingCallEvents: vi.fn(),
  getCallOutboxMetrics: vi.fn(),
  getCallWebhookSecurityConfig: vi.fn(),
  recordAuditLog: vi.fn()
}));

vi.mock("@/server/auth/session", () => ({
  getSessionUser: mocks.getSessionUser
}));

vi.mock("@/server/calls/outbox", () => ({
  deliverPendingCallEvents: mocks.deliverPendingCallEvents,
  getCallOutboxMetrics: mocks.getCallOutboxMetrics
}));

vi.mock("@/server/calls/webhook", () => ({
  getCallWebhookSecurityConfig: mocks.getCallWebhookSecurityConfig
}));

vi.mock("@/server/audit", () => ({
  recordAuditLog: mocks.recordAuditLog
}));

import { GET, POST } from "@/app/api/admin/calls/outbox/route";

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

describe("/api/admin/calls/outbox", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = {
      ...ORIGINAL_ENV,
      CALLS_OUTBOX_SECRET: "calls-secret",
      TENANT_INGRESS_REQUIRE_SECRETS: "false"
    };
    mocks.getCallOutboxMetrics.mockResolvedValue({
      provider: "mock",
      queue: {
        queued: 1,
        dueNow: 1,
        processing: 0,
        failed: 0,
        sentTotal: 10,
        sent24h: 2,
        nextAttemptAt: null,
        lastSentAt: null,
        lastFailedAt: null,
        lastError: null
      }
    });
    mocks.getCallWebhookSecurityConfig.mockReturnValue({
      mode: "hmac",
      timestampRequired: true,
      maxSkewSeconds: 300
    });
    mocks.deliverPendingCallEvents.mockResolvedValue({
      delivered: 2,
      skipped: 0,
      provider: "mock"
    });
    mocks.recordAuditLog.mockResolvedValue(undefined);
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("GET returns 403 for non-admin users", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser("agent"));

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toMatchObject({ error: "Forbidden" });
    expect(mocks.getCallOutboxMetrics).not.toHaveBeenCalled();
  });

  it("GET returns outbox metrics and webhook security posture for admins", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser("lead_admin"));

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      provider: "mock",
      queue: { queued: 1, sentTotal: 10 },
      webhookSecurity: {
        mode: "hmac",
        timestampRequired: true,
        maxSkewSeconds: 300
      }
    });
    expect(mocks.getCallOutboxMetrics).toHaveBeenCalledWith(TENANT_ID);
  });

  it("returns 403 when a lead admin session has no tenant", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser("lead_admin", null));

    const getResponse = await GET();
    const postResponse = await POST(
      new Request("http://localhost/api/admin/calls/outbox?limit=25", { method: "POST" })
    );

    expect(getResponse.status).toBe(403);
    expect(postResponse.status).toBe(403);
    expect(mocks.getCallOutboxMetrics).not.toHaveBeenCalled();
    expect(mocks.deliverPendingCallEvents).not.toHaveBeenCalled();
  });

  it("POST returns 401 for non-admin users without valid secret", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser("agent"));

    const response = await POST(
      new Request("http://localhost/api/admin/calls/outbox?limit=25", { method: "POST" })
    );
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toMatchObject({ error: "Unauthorized" });
    expect(mocks.deliverPendingCallEvents).not.toHaveBeenCalled();
  });

  it("POST runs call outbox and records audit for admins", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser("lead_admin"));

    const response = await POST(
      new Request("http://localhost/api/admin/calls/outbox?limit=25", { method: "POST" })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      status: "ok",
      delivered: 2,
      skipped: 0,
      provider: "mock"
    });
    expect(mocks.deliverPendingCallEvents).toHaveBeenCalledWith({
      limit: 25,
      tenantId: TENANT_ID
    });
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT_ID,
        action: "call_outbox_triggered"
      })
    );
  });

  it("requires tenant header for shared-secret callers", async () => {
    mocks.getSessionUser.mockResolvedValue(null);

    const response = await POST(
      new Request("http://localhost/api/admin/calls/outbox?limit=25", {
        method: "POST",
        headers: { "x-6esk-secret": "calls-secret" }
      })
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toMatchObject({ error: "Tenant header is required" });
    expect(mocks.deliverPendingCallEvents).not.toHaveBeenCalled();
  });

  it("runs call outbox for shared-secret callers with explicit tenant", async () => {
    mocks.getSessionUser.mockResolvedValue(null);

    const response = await POST(
      new Request("http://localhost/api/admin/calls/outbox?limit=8", {
        method: "POST",
        headers: {
          "x-6esk-secret": "calls-secret",
          "x-6esk-tenant-id": TENANT_ID
        }
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.deliverPendingCallEvents).toHaveBeenCalledWith({ limit: 8, tenantId: TENANT_ID });
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT_ID,
        actorUserId: null,
        data: expect.objectContaining({ authMode: "shared_secret" })
      })
    );
  });

  it("POST returns 500 and records failure audit when outbox delivery throws", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser("lead_admin"));
    mocks.deliverPendingCallEvents.mockRejectedValueOnce(new Error("call provider down"));

    const response = await POST(
      new Request("http://localhost/api/admin/calls/outbox?limit=25", { method: "POST" })
    );
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toMatchObject({
      error: "Failed to run call outbox",
      detail: "call provider down"
    });
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "call_outbox_trigger_failed"
      })
    );
  });
});
