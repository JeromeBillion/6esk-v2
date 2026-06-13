import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  isInternalStaff: vi.fn(),
  hasPrivilegedMfaSession: vi.fn(),
  getActivePrivilegedAccessGrantForSubject: vi.fn(),
  dbQuery: vi.fn(),
  recordAuditLog: vi.fn(),
  cookieGet: vi.fn()
}));

vi.mock("@/server/auth/session", () => ({
  getSessionUser: mocks.getSessionUser
}));

vi.mock("@/server/auth/roles", () => ({
  isInternalStaff: mocks.isInternalStaff
}));

vi.mock("@/server/auth/privileged-access", () => ({
  hasPrivilegedMfaSession: mocks.hasPrivilegedMfaSession,
  getActivePrivilegedAccessGrantForSubject: mocks.getActivePrivilegedAccessGrantForSubject
}));

vi.mock("@/server/db", () => ({
  db: {
    query: mocks.dbQuery
  }
}));

vi.mock("@/server/audit", () => ({
  recordAuditLog: mocks.recordAuditLog
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: mocks.cookieGet
  }))
}));

import { DELETE, POST } from "@/app/api/backoffice/impersonate/route";

function buildInternalUser(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    email: "ops@6esk.co.za",
    display_name: "Ops",
    role_id: "22222222-2222-2222-2222-222222222222",
    role_name: "internal_support",
    tenant_id: "33333333-3333-3333-3333-333333333333",
    real_tenant_id: "33333333-3333-3333-3333-333333333333",
    tenant_slug: "ops",
    is_impersonating: false,
    session_auth_provider: "password_mfa",
    ...overrides
  };
}

const ACTIVE_GRANT = {
  id: "99999999-9999-9999-9999-999999999999",
  access_type: "support",
  expires_at: new Date(Date.now() + 60 * 60_000).toISOString()
};

describe("backoffice impersonation API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.cookieGet.mockReturnValue({ value: "session-token" });
    mocks.hasPrivilegedMfaSession.mockReturnValue(true);
    mocks.getActivePrivilegedAccessGrantForSubject.mockResolvedValue(ACTIVE_GRANT);
    mocks.recordAuditLog.mockResolvedValue(undefined);
  });

  it("rejects non-internal users", async () => {
    mocks.getSessionUser.mockResolvedValue(buildInternalUser({ role_name: "tenant_admin" }));
    mocks.isInternalStaff.mockReturnValue(false);

    const response = await POST(
      new Request("http://localhost/api/backoffice/impersonate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tenantId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
          grantId: "99999999-9999-9999-9999-999999999999",
          reason: "Need to reproduce tenant issue",
          ticketRef: "INC-123"
        })
      })
    );

    expect(response.status).toBe(403);
  });

  it("requires MFA before privileged impersonation", async () => {
    mocks.getSessionUser.mockResolvedValue(buildInternalUser({ session_auth_provider: "password" }));
    mocks.isInternalStaff.mockReturnValue(true);
    mocks.hasPrivilegedMfaSession.mockReturnValue(false);

    const response = await POST(
      new Request("http://localhost/api/backoffice/impersonate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tenantId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
          grantId: "99999999-9999-9999-9999-999999999999",
          reason: "Need to reproduce tenant issue",
          ticketRef: "INC-123"
        })
      })
    );

    expect(response.status).toBe(403);
    expect(mocks.dbQuery).not.toHaveBeenCalled();
  });

  it("requires reason and ticket reference", async () => {
    mocks.getSessionUser.mockResolvedValue(buildInternalUser());
    mocks.isInternalStaff.mockReturnValue(true);

    const response = await POST(
      new Request("http://localhost/api/backoffice/impersonate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tenantId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
        })
      })
    );

    expect(response.status).toBe(400);
    expect(mocks.dbQuery).not.toHaveBeenCalled();
  });

  it("requires an active privileged access grant for the support user and tenant", async () => {
    mocks.getSessionUser.mockResolvedValue(buildInternalUser());
    mocks.isInternalStaff.mockReturnValue(true);
    mocks.getActivePrivilegedAccessGrantForSubject.mockResolvedValue(null);
    mocks.dbQuery.mockResolvedValueOnce({ rows: [{ id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" }] });

    const response = await POST(
      new Request("http://localhost/api/backoffice/impersonate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tenantId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
          grantId: "99999999-9999-9999-9999-999999999999",
          reason: "Investigating inbound webhook mismatch for tenant",
          ticketRef: "INC-9042"
        })
      })
    );

    expect(response.status).toBe(403);
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "support_impersonation_denied",
        entityId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        data: expect.objectContaining({
          reason: "active_privileged_access_grant_required"
        })
      })
    );
  });

  it("stores bounded impersonation context and audit metadata", async () => {
    mocks.getSessionUser.mockResolvedValue(buildInternalUser());
    mocks.isInternalStaff.mockReturnValue(true);
    mocks.dbQuery
      .mockResolvedValueOnce({ rows: [{ id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" }] })
      .mockResolvedValueOnce({ rowCount: 1 });

    const response = await POST(
      new Request("http://localhost/api/backoffice/impersonate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tenantId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
          grantId: "99999999-9999-9999-9999-999999999999",
          reason: "Investigating inbound webhook mismatch for tenant",
          ticketRef: "INC-9042",
          durationMinutes: 45
        })
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.getActivePrivilegedAccessGrantForSubject).toHaveBeenCalledWith({
      grantId: "99999999-9999-9999-9999-999999999999",
      tenantId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      subjectUserId: "11111111-1111-1111-1111-111111111111",
      subjectEmail: "ops@6esk.co.za"
    });
    expect(mocks.dbQuery).toHaveBeenCalledWith(
      expect.stringContaining("privileged_access_grant_id = $5"),
      [
        "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        "Investigating inbound webhook mismatch for tenant",
        "INC-9042",
        45,
        "99999999-9999-9999-9999-999999999999",
        expect.any(String),
        "11111111-1111-1111-1111-111111111111",
        "33333333-3333-3333-3333-333333333333"
      ]
    );
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "support_impersonation_started",
        data: expect.objectContaining({
          reason: "Investigating inbound webhook mismatch for tenant",
          grantId: "99999999-9999-9999-9999-999999999999",
          ticketRef: "INC-9042",
          durationMinutes: 45
        })
      })
    );
  });

  it("clears impersonation metadata on end", async () => {
    mocks.getSessionUser.mockResolvedValue(
      buildInternalUser({
        tenant_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        is_impersonating: true
      })
    );
    mocks.dbQuery.mockResolvedValue({ rowCount: 1 });

    const response = await DELETE(
      new Request("http://localhost/api/backoffice/impersonate", {
        method: "DELETE"
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.dbQuery).toHaveBeenCalledWith(
      expect.stringContaining("privileged_access_grant_id = NULL"),
      [
        expect.any(String),
        "11111111-1111-1111-1111-111111111111",
        "33333333-3333-3333-3333-333333333333"
      ]
    );
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "support_impersonation_ended"
      })
    );
  });
});
