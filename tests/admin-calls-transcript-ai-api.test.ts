import { beforeEach, describe, expect, it, vi } from "vitest";

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

function buildUser(roleName: "lead_admin" | "agent") {
  return {
    id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    email: `${roleName}@6ex.co.za`,
    display_name: roleName,
    role_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    role_name: roleName
  };
}

describe("/api/admin/calls/transcripts/ai", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CALLS_OUTBOX_SECRET = "calls-secret";
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
    expect(mocks.getTranscriptAiJobMetrics).toHaveBeenCalledWith(12);
    expect(body).toMatchObject({
      provider: "managed_http",
      analysis: { analyzed24h: 5, flagged24h: 2 }
    });
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
    expect(mocks.deliverPendingTranscriptAiJobs).toHaveBeenCalledWith({ limit: 25 });
  });
});
