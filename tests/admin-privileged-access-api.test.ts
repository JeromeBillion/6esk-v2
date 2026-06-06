import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSessionContext: vi.fn(),
  isMfaRequiredForLogin: vi.fn(),
  hasActiveMfaFactor: vi.fn(),
  listPrivilegedAccessGrants: vi.fn(),
  getPrivilegedAccessStats: vi.fn(),
  getPrivilegedAccessGrant: vi.fn(),
  createPrivilegedAccessGrant: vi.fn(),
  approvePrivilegedAccessGrant: vi.fn(),
  reviewPrivilegedAccessGrant: vi.fn(),
  revokePrivilegedAccessGrant: vi.fn(),
  sendPrivilegedAccessAlert: vi.fn(),
  recordAuditLog: vi.fn()
}));

vi.mock("@/server/auth/session", () => ({
  getSessionContext: mocks.getSessionContext
}));

vi.mock("@/server/auth/mfa", () => ({
  isMfaRequiredForLogin: mocks.isMfaRequiredForLogin,
  hasActiveMfaFactor: mocks.hasActiveMfaFactor
}));

vi.mock("@/server/auth/privileged-access", () => ({
  listPrivilegedAccessGrants: mocks.listPrivilegedAccessGrants,
  getPrivilegedAccessStats: mocks.getPrivilegedAccessStats,
  getPrivilegedAccessGrant: mocks.getPrivilegedAccessGrant,
  createPrivilegedAccessGrant: mocks.createPrivilegedAccessGrant,
  approvePrivilegedAccessGrant: mocks.approvePrivilegedAccessGrant,
  reviewPrivilegedAccessGrant: mocks.reviewPrivilegedAccessGrant,
  revokePrivilegedAccessGrant: mocks.revokePrivilegedAccessGrant
}));

vi.mock("@/server/auth/privileged-access-alerts", () => ({
  sendPrivilegedAccessAlert: mocks.sendPrivilegedAccessAlert
}));

vi.mock("@/server/audit", () => ({
  recordAuditLog: mocks.recordAuditLog
}));

import { GET, PATCH, POST } from "@/app/api/admin/security/privileged-access/route";

const user = {
  id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  email: "admin@example.com",
  display_name: "Admin",
  role_id: null,
  role_name: "lead_admin",
  tenant_key: "tenant-priv",
  workspace_key: "workspace-priv"
};

const grant = {
  id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
  tenant_key: "tenant-priv",
  workspace_key: "workspace-priv",
  access_type: "support",
  status: "pending",
  subject_email: "support@example.com",
  subject_name: "Support",
  requested_by_user_id: user.id,
  approved_by_user_id: null,
  revoked_by_user_id: null,
  reason: "Investigate an approved support issue.",
  reference: "INC-1",
  approval_note: null,
  revoke_reason: null,
  requested_duration_minutes: 60,
  requested_at: "2026-06-04T00:00:00.000Z",
  approved_at: null,
  revoked_at: null,
  expires_at: null,
  created_at: "2026-06-04T00:00:00.000Z",
  updated_at: "2026-06-04T00:00:00.000Z",
  metadata: {}
};

describe("/api/admin/security/privileged-access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSessionContext.mockResolvedValue({
      sessionId: "session-1",
      authProvider: "password_mfa",
      user
    });
    mocks.isMfaRequiredForLogin.mockResolvedValue(true);
    mocks.recordAuditLog.mockResolvedValue(undefined);
    mocks.getPrivilegedAccessStats.mockResolvedValue({
      pending: 1,
      active: 0,
      activeBreakGlass: 0,
      expired: 0,
      revoked: 0,
      needsPostEventReview: 0
    });
    mocks.sendPrivilegedAccessAlert.mockImplementation(
      async ({ grant, event }: { grant: { access_type: string }; event: string }) => ({
        event,
        status: "delivered",
        delivered: true,
        severity: grant.access_type === "break_glass" ? "critical" : "high",
        destination: "security_webhook",
        attemptedAt: "2026-06-04T00:00:00.000Z"
      })
    );
  });

  it("rejects non-admin access", async () => {
    mocks.getSessionContext.mockResolvedValue({
      sessionId: "session-1",
      authProvider: "password",
      user: { ...user, role_name: "agent" }
    });

    const response = await GET(new Request("http://localhost/api/admin/security/privileged-access"));

    expect(response.status).toBe(403);
    expect(mocks.listPrivilegedAccessGrants).not.toHaveBeenCalled();
  });

  it("blocks grant mutations for MFA-incomplete admin sessions", async () => {
    mocks.getSessionContext.mockResolvedValue({
      sessionId: "session-1",
      authProvider: "password_mfa_enrollment_required",
      user
    });

    const response = await POST(
      new Request("http://localhost/api/admin/security/privileged-access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accessType: "support",
          subjectEmail: "support@example.com",
          reason: "Investigate an approved support issue.",
          requestedDurationMinutes: 60
        })
      })
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toMatchObject({ code: "mfa_enrollment_required" });
    expect(mocks.createPrivilegedAccessGrant).not.toHaveBeenCalled();
  });

  it("lists grants inside the admin tenant workspace", async () => {
    mocks.listPrivilegedAccessGrants.mockResolvedValue([grant]);

    const response = await GET(new Request("http://localhost/api/admin/security/privileged-access?limit=10"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.grants[0]).toMatchObject({
      id: grant.id,
      tenantKey: "tenant-priv",
      workspaceKey: "workspace-priv",
      subjectEmail: "support@example.com"
    });
    expect(mocks.listPrivilegedAccessGrants).toHaveBeenCalledWith(
      { tenantKey: "tenant-priv", workspaceKey: "workspace-priv" },
      10
    );
  });

  it("creates a pending grant and records tenant-visible audit evidence", async () => {
    mocks.createPrivilegedAccessGrant.mockResolvedValue(grant);

    const response = await POST(
      new Request("http://localhost/api/admin/security/privileged-access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accessType: "support",
          subjectEmail: "support@example.com",
          subjectName: "Support",
          reason: "Investigate an approved support issue.",
          reference: "INC-1",
          requestedDurationMinutes: 60
        })
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.createPrivilegedAccessGrant).toHaveBeenCalledWith(
      { tenantKey: "tenant-priv", workspaceKey: "workspace-priv" },
      user.id,
      expect.objectContaining({ accessType: "support", subjectEmail: "support@example.com" })
    );
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantKey: "tenant-priv",
        workspaceKey: "workspace-priv",
        action: "privileged_access_requested",
        entityType: "privileged_access_grant",
        entityId: grant.id
      })
    );
    expect(mocks.sendPrivilegedAccessAlert).toHaveBeenCalledWith({
      scope: { tenantKey: "tenant-priv", workspaceKey: "workspace-priv" },
      actorUserId: user.id,
      grant,
      event: "requested"
    });
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "privileged_access_alert_delivered",
        entityId: grant.id,
        data: expect.objectContaining({
          event: "requested",
          alertStatus: "delivered",
          delivered: true
        })
      })
    );
  });

  it("requires active admin MFA before approving break-glass access", async () => {
    mocks.getPrivilegedAccessGrant.mockResolvedValue({ ...grant, access_type: "break_glass" });
    mocks.hasActiveMfaFactor.mockResolvedValue(false);

    const response = await PATCH(
      new Request("http://localhost/api/admin/security/privileged-access", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "approve",
          grantId: grant.id,
          approvalNote: "Emergency tenant-impacting incident"
        })
      })
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toContain("active admin MFA");
    expect(mocks.approvePrivilegedAccessGrant).not.toHaveBeenCalled();
    expect(mocks.recordAuditLog).not.toHaveBeenCalled();
  });

  it("approves and revokes grants with scoped audit events", async () => {
    mocks.getPrivilegedAccessGrant.mockResolvedValue(grant);
    mocks.approvePrivilegedAccessGrant.mockResolvedValue({
      ...grant,
      status: "active",
      approved_by_user_id: user.id,
      expires_at: "2026-06-04T01:00:00.000Z"
    });
    mocks.revokePrivilegedAccessGrant.mockResolvedValue({
      ...grant,
      status: "revoked",
      revoked_by_user_id: user.id,
      revoke_reason: "complete"
    });

    const approveResponse = await PATCH(
      new Request("http://localhost/api/admin/security/privileged-access", {
        method: "PATCH",
        body: JSON.stringify({ action: "approve", grantId: grant.id, approvalNote: "approved" })
      })
    );
    const revokeResponse = await PATCH(
      new Request("http://localhost/api/admin/security/privileged-access", {
        method: "PATCH",
        body: JSON.stringify({ action: "revoke", grantId: grant.id, revokeReason: "complete" })
      })
    );

    expect(approveResponse.status).toBe(200);
    expect(revokeResponse.status).toBe(200);
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "privileged_access_approved", entityId: grant.id })
    );
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "privileged_access_revoked", entityId: grant.id })
    );
  });

  it("records post-event review for ended grants", async () => {
    const revokedGrant = {
      ...grant,
      status: "revoked",
      revoked_by_user_id: user.id,
      revoke_reason: "complete"
    };
    mocks.getPrivilegedAccessGrant.mockResolvedValue(revokedGrant);
    mocks.reviewPrivilegedAccessGrant.mockResolvedValue({
      ...revokedGrant,
      metadata: {
        postEventReview: {
          reviewedByUserId: user.id,
          reviewedAt: "2026-06-04T02:00:00.000Z",
          reviewNote: "Reviewed support access evidence."
        }
      }
    });

    const response = await PATCH(
      new Request("http://localhost/api/admin/security/privileged-access", {
        method: "PATCH",
        body: JSON.stringify({
          action: "review",
          grantId: grant.id,
          reviewNote: "Reviewed support access evidence."
        })
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe("reviewed");
    expect(mocks.reviewPrivilegedAccessGrant).toHaveBeenCalledWith(
      { tenantKey: "tenant-priv", workspaceKey: "workspace-priv" },
      grant.id,
      user.id,
      "Reviewed support access evidence."
    );
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "privileged_access_reviewed",
        entityId: grant.id,
        data: expect.objectContaining({
          status: "revoked"
        })
      })
    );
  });
});
