import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  retryFailedTranscriptAiJobs: vi.fn(),
  recordAuditLog: vi.fn()
}));

vi.mock("@/server/auth/session", () => ({
  getSessionUser: mocks.getSessionUser
}));

vi.mock("@/server/calls/transcript-ai-jobs", () => ({
  retryFailedTranscriptAiJobs: mocks.retryFailedTranscriptAiJobs
}));

vi.mock("@/server/audit", () => ({
  recordAuditLog: mocks.recordAuditLog
}));

import { POST } from "@/app/api/admin/calls/transcripts/ai/retry/route";

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

describe("POST /api/admin/calls/transcripts/ai/retry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = {
      ...ORIGINAL_ENV,
      CALLS_OUTBOX_SECRET: "calls-secret",
      TENANT_INGRESS_REQUIRE_SECRETS: "false"
    };
    mocks.retryFailedTranscriptAiJobs.mockResolvedValue({
      requested: 10,
      retried: 2,
      ids: ["job-1", "job-2"]
    });
    mocks.recordAuditLog.mockResolvedValue(undefined);
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("retries failed transcript AI jobs for admins under their tenant", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser("lead_admin"));

    const response = await POST(
      new Request("http://localhost/api/admin/calls/transcripts/ai/retry?limit=10", {
        method: "POST",
        body: JSON.stringify({ jobIds: ["job-1"] })
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.retryFailedTranscriptAiJobs).toHaveBeenCalledWith({
      limit: 10,
      jobIds: ["job-1"],
      tenantId: TENANT_ID
    });
  });

  it("requires tenant header for shared-secret callers", async () => {
    mocks.getSessionUser.mockResolvedValue(null);

    const response = await POST(
      new Request("http://localhost/api/admin/calls/transcripts/ai/retry", {
        method: "POST",
        headers: { "x-6esk-secret": "calls-secret" }
      })
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toMatchObject({ error: "Tenant header is required" });
    expect(mocks.retryFailedTranscriptAiJobs).not.toHaveBeenCalled();
  });

  it("retries failed transcript AI jobs for shared-secret callers with explicit tenant", async () => {
    mocks.getSessionUser.mockResolvedValue(null);

    const response = await POST(
      new Request("http://localhost/api/admin/calls/transcripts/ai/retry?limit=6", {
        method: "POST",
        headers: {
          "x-6esk-secret": "calls-secret",
          "x-6esk-tenant-id": TENANT_ID
        }
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.retryFailedTranscriptAiJobs).toHaveBeenCalledWith({
      limit: 6,
      jobIds: undefined,
      tenantId: TENANT_ID
    });
  });
});
