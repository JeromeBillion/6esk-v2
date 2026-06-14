import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  listFailedTranscriptAiJobs: vi.fn()
}));

vi.mock("@/server/auth/session", () => ({
  getSessionUser: mocks.getSessionUser
}));

vi.mock("@/server/calls/transcript-ai-jobs", () => ({
  listFailedTranscriptAiJobs: mocks.listFailedTranscriptAiJobs
}));

import { GET } from "@/app/api/admin/calls/transcripts/ai/failed/route";

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

describe("GET /api/admin/calls/transcripts/ai/failed", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listFailedTranscriptAiJobs.mockResolvedValue([{ id: "job-1" }]);
  });

  it("returns 403 for non-admin users", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser("agent"));

    const response = await GET(new Request("http://localhost/api/admin/calls/transcripts/ai/failed"));

    expect(response.status).toBe(403);
    expect(mocks.listFailedTranscriptAiJobs).not.toHaveBeenCalled();
  });

  it("returns 403 when a lead admin session has no tenant", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser("lead_admin", null));

    const response = await GET(new Request("http://localhost/api/admin/calls/transcripts/ai/failed"));

    expect(response.status).toBe(403);
    expect(mocks.listFailedTranscriptAiJobs).not.toHaveBeenCalled();
  });

  it("returns failed transcript AI jobs for the admin tenant", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser("lead_admin"));

    const response = await GET(new Request("http://localhost/api/admin/calls/transcripts/ai/failed?limit=20"));

    expect(response.status).toBe(200);
    expect(mocks.listFailedTranscriptAiJobs).toHaveBeenCalledWith(20, TENANT_ID);
  });
});
