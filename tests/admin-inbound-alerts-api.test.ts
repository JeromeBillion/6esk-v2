import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  sendInboundFailureAlert: vi.fn(),
  recordAuditLog: vi.fn()
}));

vi.mock("@/server/auth/session", () => ({
  getSessionUser: mocks.getSessionUser
}));

vi.mock("@/server/email/inbound-alerts", () => ({
  sendInboundFailureAlert: mocks.sendInboundFailureAlert
}));

vi.mock("@/server/audit", () => ({
  recordAuditLog: mocks.recordAuditLog
}));

import { POST } from "@/app/api/admin/inbound/alerts/route";

const ORIGINAL_ENV = { ...process.env };

function buildUser(roleName: "lead_admin" | "agent") {
  return {
    id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    email: `${roleName}@6ex.co.za`,
    display_name: roleName,
    role_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    role_name: roleName
  };
}

describe("POST /api/admin/inbound/alerts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.INBOUND_SHARED_SECRET = "inbound-alert-secret";
    mocks.sendInboundFailureAlert.mockResolvedValue({
      sent: true,
      reason: "sent",
      failures: 7,
      threshold: 5,
      windowMinutes: 30,
      cooldownMinutes: 60,
      source: "db",
      topFailureReasons: [{ code: "provider_timeout", label: "Provider Timeout", count: 4 }]
    });
    mocks.recordAuditLog.mockResolvedValue(undefined);
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("returns 401 for non-admin users without valid secret", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser("agent"));

    const response = await POST(new Request("http://localhost/api/admin/inbound/alerts", { method: "POST" }));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toMatchObject({ error: "Unauthorized" });
    expect(mocks.sendInboundFailureAlert).not.toHaveBeenCalled();
    expect(mocks.recordAuditLog).not.toHaveBeenCalled();
  });

  it("allows lead admins without secret header", async () => {
    const admin = buildUser("lead_admin");
    mocks.getSessionUser.mockResolvedValue(admin);

    const response = await POST(new Request("http://localhost/api/admin/inbound/alerts", { method: "POST" }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      status: "ok",
      sent: true,
      reason: "sent",
      failures: 7
    });
    expect(mocks.sendInboundFailureAlert).toHaveBeenCalledTimes(1);
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: admin.id,
        action: "inbound_alert_checked"
      })
    );
  });

  it("allows shared-secret callers without a session user", async () => {
    mocks.getSessionUser.mockResolvedValue(null);

    const response = await POST(
      new Request("http://localhost/api/admin/inbound/alerts", {
        method: "POST",
        headers: { "x-6esk-secret": "inbound-alert-secret" }
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      status: "ok",
      sent: true,
      reason: "sent",
      failures: 7
    });
    expect(mocks.sendInboundFailureAlert).toHaveBeenCalledTimes(1);
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: null,
        action: "inbound_alert_checked"
      })
    );
  });

  it("returns 500 and records failure audit when alert execution throws", async () => {
    const admin = buildUser("lead_admin");
    mocks.getSessionUser.mockResolvedValue(admin);
    mocks.sendInboundFailureAlert.mockRejectedValue(new Error("Webhook failed with 502"));

    const response = await POST(
      new Request("http://localhost/api/admin/inbound/alerts", {
        method: "POST"
      })
    );
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toMatchObject({
      error: "Failed to run inbound alert check",
      detail: "Webhook failed with 502"
    });
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: admin.id,
        action: "inbound_alert_check_failed"
      })
    );
  });
});
