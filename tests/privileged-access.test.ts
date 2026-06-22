import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dbQuery: vi.fn(),
  dbConnect: vi.fn(),
  clientQuery: vi.fn(),
  clientRelease: vi.fn(),
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
const USER_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const APPROVER_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const GRANT_ID = "dddddddd-dddd-dddd-dddd-dddddddddddd";

const GRANT_ROW = {
  id: GRANT_ID,
  tenant_id: TENANT_ID,
  workspace_key: "primary",
  access_type: "support",
  status: "pending",
  subject_user_id: USER_ID,
  subject_email: "support@6esk.co.za",
  subject_name: "Support",
  requested_by_user_id: USER_ID,
  approved_by_user_id: null,
  revoked_by_user_id: null,
  reason: "Investigating tenant support issue",
  reference: "INC-100",
  approval_note: null,
  revoke_reason: null,
  requested_duration_minutes: 60,
  requested_at: "2026-06-06T10:00:00.000Z",
  approved_at: null,
  revoked_at: null,
  expires_at: null,
  created_at: "2026-06-06T10:00:00.000Z",
  updated_at: "2026-06-06T10:00:00.000Z",
  metadata: {}
};

describe("privileged access service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.dbConnect.mockResolvedValue({
      query: mocks.clientQuery,
      release: mocks.clientRelease
    });
    mocks.clientQuery.mockResolvedValue({ rows: [] });
    mocks.recordAuditLogWithClient.mockResolvedValue(undefined);
  });

  it("creates tenant-id scoped pending grants with normalized subject email", async () => {
    const { createPrivilegedAccessGrant } = await import("@/server/auth/privileged-access");
    mocks.clientQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [GRANT_ROW] })
      .mockResolvedValueOnce({ rows: [] });

    const grant = await createPrivilegedAccessGrant(
      { tenantId: TENANT_ID },
      USER_ID,
      {
        accessType: "support",
        subjectUserId: USER_ID,
        subjectEmail: " Support@6esk.co.za ",
        reason: "Investigating tenant support issue",
        reference: "INC-100",
        requestedDurationMinutes: 999,
        metadata: { source: "test" }
      }
    );

    expect(grant).toBe(GRANT_ROW);
    expect(mocks.clientQuery).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO privileged_access_grants"),
      expect.arrayContaining([TENANT_ID, "primary", "support", USER_ID, "support@6esk.co.za"])
    );
    const params = mocks.clientQuery.mock.calls[1][1];
    expect(params[9]).toBe(480);
    expect(mocks.recordAuditLogWithClient).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        tenantId: TENANT_ID,
        actorUserId: USER_ID,
        action: "privileged_access_grant_requested",
        entityId: GRANT_ID
      })
    );
  });

  it("prevents self-approval of pending grants", async () => {
    const { approvePrivilegedAccessGrant } = await import("@/server/auth/privileged-access");
    mocks.clientQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    await expect(
      approvePrivilegedAccessGrant({ tenantId: TENANT_ID }, GRANT_ID, USER_ID, "Approved")
    ).rejects.toThrow(/self-approved/);
    expect(mocks.clientQuery).toHaveBeenCalledWith(
      expect.stringContaining("requested_by_user_id IS NULL OR requested_by_user_id <> $4"),
      [GRANT_ID, TENANT_ID, "primary", USER_ID, "Approved"]
    );
    expect(mocks.clientQuery).toHaveBeenCalledWith("ROLLBACK");
    expect(mocks.recordAuditLogWithClient).not.toHaveBeenCalled();
  });

  it("loads only active grants for the requested tenant and subject", async () => {
    const { getActivePrivilegedAccessGrantForSubject } = await import("@/server/auth/privileged-access");
    mocks.dbQuery.mockResolvedValueOnce({
      rows: [{ ...GRANT_ROW, status: "active", approved_by_user_id: APPROVER_ID }]
    });

    const grant = await getActivePrivilegedAccessGrantForSubject({
      grantId: GRANT_ID,
      tenantId: TENANT_ID,
      subjectUserId: USER_ID,
      subjectEmail: "support@6esk.co.za"
    });

    expect(grant?.id).toBe(GRANT_ID);
    expect(mocks.dbQuery).toHaveBeenCalledWith(
      expect.stringContaining("status = 'active'"),
      [GRANT_ID, TENANT_ID, "primary", ["support", "break_glass"], USER_ID, "support@6esk.co.za"]
    );
  });
});
