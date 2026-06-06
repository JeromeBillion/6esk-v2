import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dbQuery: vi.fn()
}));

vi.mock("@/server/db", () => ({
  db: {
    query: mocks.dbQuery
  }
}));

import {
  approvePrivilegedAccessGrant,
  createPrivilegedAccessGrant,
  getActivePrivilegedAccessGrantForSubject,
  getPrivilegedAccessStats,
  listPrivilegedAccessGrants,
  maxPrivilegedAccessDurationMinutes,
  reviewPrivilegedAccessGrant,
  revokePrivilegedAccessGrant
} from "@/server/auth/privileged-access";

const scope = { tenantKey: "tenant-priv", workspaceKey: "workspace-priv" };

describe("privileged access grants", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.dbQuery.mockResolvedValue({ rows: [] });
  });

  it("caps break-glass duration at one hour", async () => {
    expect(maxPrivilegedAccessDurationMinutes("break_glass")).toBe(60);
    expect(maxPrivilegedAccessDurationMinutes("support")).toBe(480);
  });

  it("creates a tenant-scoped pending access grant", async () => {
    mocks.dbQuery.mockResolvedValueOnce({
      rows: [
        {
          id: "grant-1",
          tenant_key: "tenant-priv",
          workspace_key: "workspace-priv",
          access_type: "support",
          status: "pending",
          subject_email: "support@example.com",
          subject_name: null,
          requested_by_user_id: "user-1",
          approved_by_user_id: null,
          revoked_by_user_id: null,
          reason: "Investigate an incident with tenant approval.",
          reference: "INC-1",
          approval_note: null,
          revoke_reason: null,
          requested_duration_minutes: 120,
          requested_at: "2026-06-04T00:00:00.000Z",
          approved_at: null,
          revoked_at: null,
          expires_at: null,
          created_at: "2026-06-04T00:00:00.000Z",
          updated_at: "2026-06-04T00:00:00.000Z",
          metadata: {}
        }
      ]
    });

    await expect(
      createPrivilegedAccessGrant(scope, "user-1", {
        accessType: "support",
        subjectEmail: "Support@Example.com",
        reason: "Investigate an incident with tenant approval.",
        reference: "INC-1",
        requestedDurationMinutes: 120
      })
    ).resolves.toMatchObject({
      tenant_key: "tenant-priv",
      workspace_key: "workspace-priv",
      subject_email: "support@example.com"
    });
    expect(mocks.dbQuery).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO privileged_access_grants"),
      expect.arrayContaining(["tenant-priv", "workspace-priv", "support", "support@example.com"])
    );
  });

  it("lists grants inside the current tenant workspace", async () => {
    mocks.dbQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    await listPrivilegedAccessGrants(scope, 25);

    expect(mocks.dbQuery).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("UPDATE privileged_access_grants"),
      ["tenant-priv", "workspace-priv"]
    );
    expect(mocks.dbQuery).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("WHERE tenant_key = $1"),
      ["tenant-priv", "workspace-priv", 25]
    );
    expect(mocks.dbQuery).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("AND workspace_key = $2"),
      ["tenant-priv", "workspace-priv", 25]
    );
  });

  it("counts ended grants that still need post-event review", async () => {
    mocks.dbQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            pending: 1,
            active: 2,
            active_break_glass: 1,
            expired: 3,
            revoked: 4,
            needs_post_event_review: 5
          }
        ]
      });

    await expect(getPrivilegedAccessStats(scope)).resolves.toMatchObject({
      pending: 1,
      active: 2,
      activeBreakGlass: 1,
      expired: 3,
      revoked: 4,
      needsPostEventReview: 5
    });
    expect(mocks.dbQuery).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("metadata->'postEventReview' IS NULL"),
      ["tenant-priv", "workspace-priv"]
    );
  });

  it("looks up only active, unexpired grants for the support subject", async () => {
    mocks.dbQuery.mockResolvedValueOnce({
      rows: [
        {
          id: "grant-1",
          tenant_key: "tenant-priv",
          workspace_key: "workspace-priv",
          access_type: "support",
          status: "active",
          subject_email: "support@example.com"
        }
      ]
    });

    await expect(
      getActivePrivilegedAccessGrantForSubject({
        grantId: "grant-1",
        subjectEmail: "Support@Example.com",
        accessTypes: ["support"]
      })
    ).resolves.toMatchObject({
      tenant_key: "tenant-priv",
      workspace_key: "workspace-priv"
    });

    expect(mocks.dbQuery).toHaveBeenCalledWith(
      expect.stringContaining("AND lower(subject_email) = $2"),
      ["grant-1", "support@example.com", ["support"]]
    );
    expect(mocks.dbQuery).toHaveBeenCalledWith(
      expect.stringContaining("AND expires_at > now()"),
      ["grant-1", "support@example.com", ["support"]]
    );
    expect(mocks.dbQuery).toHaveBeenCalledWith(
      expect.stringContaining("AND access_type = ANY($3::text[])"),
      ["grant-1", "support@example.com", ["support"]]
    );
  });

  it("approves and revokes grants with scoped mutations", async () => {
    mocks.dbQuery
      .mockResolvedValueOnce({
        rows: [
          {
            id: "grant-1",
            tenant_key: "tenant-priv",
            workspace_key: "workspace-priv",
            access_type: "support",
            status: "active"
          }
        ]
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "grant-1",
            tenant_key: "tenant-priv",
            workspace_key: "workspace-priv",
            access_type: "support",
            status: "revoked"
          }
        ]
      });

    await approvePrivilegedAccessGrant(scope, "grant-1", "admin-1", "approved");
    await revokePrivilegedAccessGrant(scope, "grant-1", "admin-1", "complete");

    expect(mocks.dbQuery).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("AND status = 'pending'"),
      ["grant-1", "tenant-priv", "workspace-priv", "admin-1", "approved"]
    );
    expect(mocks.dbQuery).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("AND status IN ('pending', 'active')"),
      ["grant-1", "tenant-priv", "workspace-priv", "admin-1", "complete"]
    );
  });

  it("records post-event review only for ended grants inside the tenant workspace", async () => {
    mocks.dbQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "grant-1",
            tenant_key: "tenant-priv",
            workspace_key: "workspace-priv",
            access_type: "support",
            status: "revoked",
            metadata: {
              postEventReview: {
                reviewedByUserId: "admin-1",
                reviewNote: "Reviewed support evidence."
              }
            }
          }
        ]
      });

    await expect(
      reviewPrivilegedAccessGrant(scope, "grant-1", "admin-1", "Reviewed support evidence.")
    ).resolves.toMatchObject({
      tenant_key: "tenant-priv",
      workspace_key: "workspace-priv",
      status: "revoked"
    });
    expect(mocks.dbQuery).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("AND status IN ('expired', 'revoked')"),
      ["grant-1", "tenant-priv", "workspace-priv", expect.any(String)]
    );
    expect(mocks.dbQuery).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("'{postEventReview}'"),
      ["grant-1", "tenant-priv", "workspace-priv", expect.any(String)]
    );
  });
});
