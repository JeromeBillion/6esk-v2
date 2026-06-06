import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dbQuery: vi.fn()
}));

vi.mock("@/server/db", () => ({
  db: {
    query: mocks.dbQuery
  }
}));

import { sendPrivilegedAccessAlert } from "@/server/auth/privileged-access-alerts";
import type { PrivilegedAccessGrant } from "@/server/auth/privileged-access";

const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_WEBHOOK = process.env.SECURITY_ALERT_WEBHOOK;

const grant = {
  id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
  tenant_key: "tenant-priv",
  workspace_key: "workspace-priv",
  access_type: "break_glass",
  status: "active",
  subject_email: "support@example.com",
  subject_name: "Support",
  requested_by_user_id: "admin-1",
  approved_by_user_id: "admin-1",
  revoked_by_user_id: null,
  reason: "Investigate approved production incident.",
  reference: "INC-1",
  approval_note: "Emergency approval.",
  revoke_reason: null,
  requested_duration_minutes: 30,
  requested_at: "2026-06-04T00:00:00.000Z",
  approved_at: "2026-06-04T00:01:00.000Z",
  revoked_at: null,
  expires_at: "2026-06-04T00:31:00.000Z",
  created_at: "2026-06-04T00:00:00.000Z",
  updated_at: "2026-06-04T00:01:00.000Z",
  metadata: {}
} satisfies PrivilegedAccessGrant;

describe("privileged access alerts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.dbQuery.mockResolvedValue({ rows: [] });
    process.env.SECURITY_ALERT_WEBHOOK = "https://alerts.example.com/security";
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => ""
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH;
    process.env.SECURITY_ALERT_WEBHOOK = ORIGINAL_WEBHOOK;
  });

  it("delivers a security webhook and appends a tenant-scoped alert outcome", async () => {
    const outcome = await sendPrivilegedAccessAlert({
      scope: { tenantKey: "tenant-priv", workspaceKey: "workspace-priv" },
      grant,
      event: "approved",
      actorUserId: "admin-1"
    });

    expect(outcome).toMatchObject({
      event: "approved",
      status: "delivered",
      delivered: true,
      severity: "critical"
    });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://alerts.example.com/security",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" }
      })
    );
    const [, init] = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({
      event: "approved",
      tenantKey: "tenant-priv",
      workspaceKey: "workspace-priv",
      grantId: grant.id,
      accessType: "break_glass"
    });
    expect(mocks.dbQuery).toHaveBeenCalledWith(
      expect.stringContaining("metadata->'securityAlerts'"),
      [grant.id, "tenant-priv", "workspace-priv", expect.any(String)]
    );
  });

  it("records missing webhook outcomes without attempting delivery", async () => {
    process.env.SECURITY_ALERT_WEBHOOK = "";

    const outcome = await sendPrivilegedAccessAlert({
      scope: { tenantKey: "tenant-priv", workspaceKey: "workspace-priv" },
      grant,
      event: "requested",
      actorUserId: "admin-1"
    });

    expect(outcome).toMatchObject({
      event: "requested",
      status: "missing_webhook",
      delivered: false
    });
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(mocks.dbQuery).toHaveBeenCalledWith(
      expect.stringContaining("AND workspace_key = $3"),
      [grant.id, "tenant-priv", "workspace-priv", expect.any(String)]
    );
  });

  it("records failed webhook outcomes without throwing", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      text: async () => "webhook failed"
    }) as unknown as typeof fetch;

    const outcome = await sendPrivilegedAccessAlert({
      scope: { tenantKey: "tenant-priv", workspaceKey: "workspace-priv" },
      grant,
      event: "revoked",
      actorUserId: "admin-1"
    });

    expect(outcome).toMatchObject({
      event: "revoked",
      status: "failed",
      delivered: false,
      error: "webhook failed"
    });
    expect(mocks.dbQuery).toHaveBeenCalledWith(
      expect.stringContaining("jsonb_build_array($4::jsonb)"),
      [grant.id, "tenant-priv", "workspace-priv", expect.any(String)]
    );
  });
});
