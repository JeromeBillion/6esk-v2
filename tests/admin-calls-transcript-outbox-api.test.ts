import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  getTranscriptJobMetrics: vi.fn(),
  deliverPendingTranscriptJobs: vi.fn(),
  recordAuditLog: vi.fn()
}));

vi.mock("@/server/auth/session", () => ({
  getSessionUser: mocks.getSessionUser
}));

vi.mock("@/server/calls/transcript-jobs", () => ({
  getTranscriptJobMetrics: mocks.getTranscriptJobMetrics
}));

vi.mock("@/server/calls/transcript-worker", () => ({
  deliverPendingTranscriptJobs: mocks.deliverPendingTranscriptJobs
}));

vi.mock("@/server/audit", () => ({
  recordAuditLog: mocks.recordAuditLog
}));

import { GET, POST } from "@/app/api/admin/calls/transcripts/outbox/route";

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

describe("/api/admin/calls/transcripts/outbox", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = {
      ...ORIGINAL_ENV,
      CALLS_OUTBOX_SECRET: "calls-secret",
      TENANT_INGRESS_REQUIRE_SECRETS: "false"
    };
    mocks.getTranscriptJobMetrics.mockResolvedValue({
      provider: "managed_http",
      queue: { queued: 1, dueNow: 1, failed: 0 }
    });
    mocks.deliverPendingTranscriptJobs.mockResolvedValue({
      delivered: 1,
      skipped: 0,
      provider: "managed_http"
    });
    mocks.recordAuditLog.mockResolvedValue(undefined);
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("returns transcript metrics for the lead admin tenant", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser("lead_admin"));

    const response = await GET();

    expect(response.status).toBe(200);
    expect(mocks.getTranscriptJobMetrics).toHaveBeenCalledWith(TENANT_ID);
  });

  it("returns 403 when a lead admin session has no tenant", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser("lead_admin", null));

    const getResponse = await GET();
    const postResponse = await POST(
      new Request("http://localhost/api/admin/calls/transcripts/outbox", { method: "POST" })
    );

    expect(getResponse.status).toBe(403);
    expect(postResponse.status).toBe(403);
    expect(mocks.getTranscriptJobMetrics).not.toHaveBeenCalled();
    expect(mocks.deliverPendingTranscriptJobs).not.toHaveBeenCalled();
  });

  it("requires tenant header for shared-secret callers", async () => {
    mocks.getSessionUser.mockResolvedValue(null);

    const response = await POST(
      new Request("http://localhost/api/admin/calls/transcripts/outbox", {
        method: "POST",
        headers: { "x-6esk-secret": "calls-secret" }
      })
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toMatchObject({ error: "Tenant header is required" });
    expect(mocks.deliverPendingTranscriptJobs).not.toHaveBeenCalled();
  });

  it("runs transcript outbox for shared-secret callers with explicit tenant", async () => {
    mocks.getSessionUser.mockResolvedValue(null);

    const response = await POST(
      new Request("http://localhost/api/admin/calls/transcripts/outbox?limit=8", {
        method: "POST",
        headers: {
          "x-6esk-secret": "calls-secret",
          "x-6esk-tenant-id": TENANT_ID
        }
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.deliverPendingTranscriptJobs).toHaveBeenCalledWith({ limit: 8, tenantId: TENANT_ID });
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT_ID,
        actorUserId: null,
        data: expect.objectContaining({ authMode: "shared_secret" })
      })
    );
  });
});
