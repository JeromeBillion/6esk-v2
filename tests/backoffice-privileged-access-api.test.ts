import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  isInternalStaff: vi.fn(),
  hasPrivilegedMfaSession: vi.fn(),
  listPrivilegedAccessGrants: vi.fn(),
  getPrivilegedAccessStats: vi.fn(),
  createPrivilegedAccessGrant: vi.fn(),
  approvePrivilegedAccessGrant: vi.fn(),
  revokePrivilegedAccessGrant: vi.fn(),
  reviewPrivilegedAccessGrant: vi.fn(),
  recordAuditLog: vi.fn()
}));

vi.mock("@/server/auth/session", () => ({
  getSessionUser: mocks.getSessionUser
}));

vi.mock("@/server/auth/roles", () => ({
  INTERNAL_ADMIN_ROLE: "internal_admin",
  isInternalStaff: mocks.isInternalStaff
}));

vi.mock("@/server/auth/privileged-access", () => ({
  hasPrivilegedMfaSession: mocks.hasPrivilegedMfaSession,
  listPrivilegedAccessGrants: mocks.listPrivilegedAccessGrants,
  getPrivilegedAccessStats: mocks.getPrivilegedAccessStats,
  createPrivilegedAccessGrant: mocks.createPrivilegedAccessGrant,
  approvePrivilegedAccessGrant: mocks.approvePrivilegedAccessGrant,
  revokePrivilegedAccessGrant: mocks.revokePrivilegedAccessGrant,
  reviewPrivilegedAccessGrant: mocks.reviewPrivilegedAccessGrant
}));

vi.mock("@/server/audit", () => ({
  recordAuditLog: mocks.recordAuditLog
}));

import { GET, POST as CREATE } from "@/app/api/backoffice/privileged-access/route";
import { POST as ACTION } from "@/app/api/backoffice/privileged-access/[grantId]/route";

const TENANT_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const USER_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const GRANT_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc";

const internalSupport = {
  id: USER_ID,
  email: "support@6esk.co.za",
  display_name: "Support",
  role_name: "internal_support",
  tenant_id: "00000000-0000-0000-0000-000000000001",
  real_tenant_id: "00000000-0000-0000-0000-000000000001",
  tenant_slug: "6esk",
  is_impersonating: false,
  session_auth_provider: "password_mfa"
};

const internalAdmin = {
  ...internalSupport,
  id: "dddddddd-dddd-dddd-dddd-dddddddddddd",
  email: "admin@6esk.co.za",
  role_name: "internal_admin"
};

const grant = {
  id: GRANT_ID,
  tenant_id: TENANT_ID,
  workspace_key: "primary",
  access_type: "support",
  status: "pending",
  subject_email: "support@6esk.co.za",
  requested_duration_minutes: 60,
  reference: "INC-100",
  expires_at: null
};

describe("backoffice privileged access API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isInternalStaff.mockReturnValue(true);
    mocks.hasPrivilegedMfaSession.mockReturnValue(true);
    mocks.recordAuditLog.mockResolvedValue(undefined);
  });

  it("requires MFA for privileged access listing", async () => {
    mocks.getSessionUser.mockResolvedValue({ ...internalSupport, session_auth_provider: "password" });
    mocks.hasPrivilegedMfaSession.mockReturnValue(false);

    const response = await GET(new Request(`http://localhost/api/backoffice/privileged-access?tenantId=${TENANT_ID}`));

    expect(response.status).toBe(403);
    expect(mocks.listPrivilegedAccessGrants).not.toHaveBeenCalled();
  });

  it("lists grants and stats for a tenant", async () => {
    mocks.getSessionUser.mockResolvedValue(internalSupport);
    mocks.listPrivilegedAccessGrants.mockResolvedValue([grant]);
    mocks.getPrivilegedAccessStats.mockResolvedValue({ pending: 1, active: 0 });

    const response = await GET(new Request(`http://localhost/api/backoffice/privileged-access?tenantId=${TENANT_ID}`));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ grants: [grant], stats: { pending: 1, active: 0 } });
    expect(mocks.listPrivilegedAccessGrants).toHaveBeenCalledWith(
      { tenantId: TENANT_ID, workspaceKey: "primary" },
      25
    );
  });

  it("creates a self-requested grant for the current internal user", async () => {
    mocks.getSessionUser.mockResolvedValue(internalSupport);
    mocks.createPrivilegedAccessGrant.mockResolvedValue(grant);

    const response = await CREATE(
      new Request("http://localhost/api/backoffice/privileged-access", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tenantId: TENANT_ID,
          reason: "Investigating tenant support issue",
          reference: "INC-100"
        })
      })
    );

    expect(response.status).toBe(201);
    expect(mocks.createPrivilegedAccessGrant).toHaveBeenCalledWith(
      { tenantId: TENANT_ID, workspaceKey: "primary" },
      USER_ID,
      expect.objectContaining({
        subjectUserId: USER_ID,
        subjectEmail: "support@6esk.co.za"
      })
    );
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT_ID,
        action: "privileged_access_grant_requested",
        entityId: GRANT_ID
      })
    );
  });

  it("does not attach the actor user id when creating a grant for another subject email", async () => {
    mocks.getSessionUser.mockResolvedValue(internalAdmin);
    mocks.createPrivilegedAccessGrant.mockResolvedValue({
      ...grant,
      subject_email: "support@6esk.co.za",
      subject_user_id: null
    });

    const response = await CREATE(
      new Request("http://localhost/api/backoffice/privileged-access", {
        method: "POST",
        body: JSON.stringify({
          tenantId: TENANT_ID,
          subjectEmail: "support@6esk.co.za",
          reason: "Investigating tenant support issue",
          reference: "INC-100"
        })
      })
    );

    expect(response.status).toBe(201);
    expect(mocks.createPrivilegedAccessGrant).toHaveBeenCalledWith(
      { tenantId: TENANT_ID, workspaceKey: "primary" },
      internalAdmin.id,
      expect.objectContaining({
        subjectUserId: null,
        subjectEmail: "support@6esk.co.za",
        subjectName: null
      })
    );
  });

  it("approves grants only for internal admin MFA sessions", async () => {
    mocks.getSessionUser.mockResolvedValue(internalAdmin);
    mocks.approvePrivilegedAccessGrant.mockResolvedValue({
      ...grant,
      status: "active",
      expires_at: "2026-06-06T12:00:00.000Z"
    });

    const response = await ACTION(
      new Request(`http://localhost/api/backoffice/privileged-access/${GRANT_ID}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tenantId: TENANT_ID,
          action: "approve",
          approvalNote: "Approved for support incident"
        })
      }),
      { params: Promise.resolve({ grantId: GRANT_ID }) }
    );

    expect(response.status).toBe(200);
    expect(mocks.approvePrivilegedAccessGrant).toHaveBeenCalledWith(
      { tenantId: TENANT_ID, workspaceKey: "primary" },
      GRANT_ID,
      internalAdmin.id,
      "Approved for support incident"
    );
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "privileged_access_grant_approved",
        entityId: GRANT_ID
      })
    );
  });

  it("rejects grant approval by internal support users", async () => {
    mocks.getSessionUser.mockResolvedValue(internalSupport);

    const response = await ACTION(
      new Request(`http://localhost/api/backoffice/privileged-access/${GRANT_ID}`, {
        method: "POST",
        body: JSON.stringify({ tenantId: TENANT_ID, action: "approve" })
      }),
      { params: Promise.resolve({ grantId: GRANT_ID }) }
    );

    expect(response.status).toBe(403);
    expect(mocks.approvePrivilegedAccessGrant).not.toHaveBeenCalled();
  });
});
