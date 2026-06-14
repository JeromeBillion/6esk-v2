import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  getTranscriptAiJobMetrics: vi.fn(),
  deliverPendingTranscriptAiJobs: vi.fn(),
  recordAuditLog: vi.fn()
}));

vi.mock("@/server/auth/session", () => ({
  getSessionUser: mocks.getSessionUser
}));

vi.mock("@/server/calls/transcript-ai-jobs", () => ({
  getTranscriptAiJobMetrics: mocks.getTranscriptAiJobMetrics
}));

vi.mock("@/server/calls/transcript-ai-worker", () => ({
  deliverPendingTranscriptAiJobs: mocks.deliverPendingTranscriptAiJobs
}));

vi.mock("@/server/audit", () => ({
  recordAuditLog: mocks.recordAuditLog
}));

import { GET, POST } from "@/app/api/admin/calls/transcripts/ai/route";

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

describe("/api/admin/calls/transcripts/ai", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = {
      ...ORIGINAL_ENV,
      CALLS_OUTBOX_SECRET: "calls-secret",
      TENANT_INGRESS_REQUIRE_SECRETS: "false"
    };
    mocks.getTranscriptAiJobMetrics.mockResolvedValue({
      provider: "managed_http",
      queue: { queued: 1, dueNow: 1, processing: 0, failed: 0, completed24h: 5, nextAttemptAt: null, lastCompletedAt: null, lastFailedAt: null, lastError: null },
      analysis: { analyzed24h: 5, pass24h: 3, watch24h: 1, review24h: 1, flagged24h: 2, totalQaFlags24h: 2, totalActionItems24h: 1 },
      recentFlagged: []
    });
    mocks.deliverPendingTranscriptAiJobs.mockResolvedValue({
      delivered: 2,
      skipped: 0,
      provider: "managed_http"
    });
    mocks.recordAuditLog.mockResolvedValue(undefined);
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("GET returns 403 for non-admin users", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser("agent"));

    const response = await GET(new Request("http://localhost/api/admin/calls/transcripts/ai"));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toMatchObject({ error: "Forbidden" });
  });

  it("GET returns transcript QA metrics for admins", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser("lead_admin"));

    const response = await GET(new Request("http://localhost/api/admin/calls/transcripts/ai?limit=12"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.getTranscriptAiJobMetrics).toHaveBeenCalledWith(12, TENANT_ID);
    expect(body).toMatchObject({
      provider: "managed_http",
      analysis: { analyzed24h: 5, flagged24h: 2 }
    });
  });

  it("returns 403 when a lead admin session has no tenant", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser("lead_admin", null));

    const getResponse = await GET(new Request("http://localhost/api/admin/calls/transcripts/ai"));
    const postResponse = await POST(
      new Request("http://localhost/api/admin/calls/transcripts/ai?limit=25", { method: "POST" })
    );

    expect(getResponse.status).toBe(403);
    expect(postResponse.status).toBe(403);
    expect(mocks.getTranscriptAiJobMetrics).not.toHaveBeenCalled();
    expect(mocks.deliverPendingTranscriptAiJobs).not.toHaveBeenCalled();
  });

  it("POST runs transcript QA outbox for admins", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser("lead_admin"));

    const response = await POST(
      new Request("http://localhost/api/admin/calls/transcripts/ai?limit=25", { method: "POST" })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      status: "ok",
      delivered: 2,
      skipped: 0,
      provider: "managed_http"
    });
    expect(mocks.deliverPendingTranscriptAiJobs).toHaveBeenCalledWith({ limit: 25, tenantId: TENANT_ID });
  });

  it("requires tenant header for shared-secret callers", async () => {
    mocks.getSessionUser.mockResolvedValue(null);

    const response = await POST(
      new Request("http://localhost/api/admin/calls/transcripts/ai?limit=25", {
        method: "POST",
        headers: { "x-6esk-secret": "calls-secret" }
      })
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toMatchObject({ error: "Tenant header is required" });
    expect(mocks.deliverPendingTranscriptAiJobs).not.toHaveBeenCalled();
  });

  it("runs transcript QA outbox for shared-secret callers with explicit tenant", async () => {
    mocks.getSessionUser.mockResolvedValue(null);

    const response = await POST(
      new Request("http://localhost/api/admin/calls/transcripts/ai?limit=8", {
        method: "POST",
        headers: {
          "x-6esk-secret": "calls-secret",
          "x-6esk-tenant-id": TENANT_ID
        }
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.deliverPendingTranscriptAiJobs).toHaveBeenCalledWith({ limit: 8, tenantId: TENANT_ID });
  });
});
