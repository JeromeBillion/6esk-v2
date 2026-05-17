import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  isInternalStaff: vi.fn(),
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
    ...overrides
  };
}

describe("backoffice impersonation API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.cookieGet.mockReturnValue({ value: "session-token" });
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
          reason: "Need to reproduce tenant issue",
          ticketRef: "INC-123"
        })
      })
    );

    expect(response.status).toBe(403);
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
          reason: "Investigating inbound webhook mismatch for tenant",
          ticketRef: "INC-9042",
          durationMinutes: 45
        })
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.dbQuery).toHaveBeenCalledWith(
      expect.stringContaining("impersonation_expires_at = now() + make_interval(mins => $4::int)"),
      [
        "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        "Investigating inbound webhook mismatch for tenant",
        "INC-9042",
        45,
        expect.any(String)
      ]
    );
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "support_impersonation_started",
        data: expect.objectContaining({
          reason: "Investigating inbound webhook mismatch for tenant",
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
      expect.stringContaining("impersonation_expires_at = NULL"),
      [expect.any(String)]
    );
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "support_impersonation_ended"
      })
    );
  });
});
