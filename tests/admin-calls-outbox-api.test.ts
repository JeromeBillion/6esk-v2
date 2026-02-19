import { beforeEach, describe, expect, it, vi } from "vitest";

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

function buildUser(roleName: "lead_admin" | "agent") {
  return {
    id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    email: `${roleName}@6ex.co.za`,
    display_name: roleName,
    role_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    role_name: roleName
  };
}

describe("/api/admin/calls/outbox", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CALLS_OUTBOX_SECRET = "calls-secret";
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
    expect(mocks.deliverPendingCallEvents).toHaveBeenCalledWith({ limit: 25 });
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "call_outbox_triggered"
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
