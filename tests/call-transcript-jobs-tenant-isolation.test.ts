import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dbQuery: vi.fn(),
  dbConnect: vi.fn(),
  clientQuery: vi.fn(),
  clientRelease: vi.fn(),
  getTranscriptProvider: vi.fn(),
  getTranscriptAiProvider: vi.fn()
}));

vi.mock("@/server/db", () => ({
  db: {
    query: mocks.dbQuery,
    connect: mocks.dbConnect
  }
}));

vi.mock("@/server/calls/stt-provider", () => ({
  getTranscriptProvider: mocks.getTranscriptProvider
}));

vi.mock("@/server/calls/transcript-ai-provider", () => ({
  getTranscriptAiProvider: mocks.getTranscriptAiProvider
}));

import {
  lockPendingTranscriptJobs,
  retryFailedTranscriptJobs
} from "@/server/calls/transcript-jobs";
import {
  listFailedTranscriptAiJobs,
  lockPendingTranscriptAiJobs,
  retryFailedTranscriptAiJobs
} from "@/server/calls/transcript-ai-jobs";

const TENANT_ID = "22222222-2222-4222-8222-222222222222";

function setupClient() {
  mocks.clientQuery.mockResolvedValue({ rows: [] });
  mocks.dbConnect.mockResolvedValue({
    query: mocks.clientQuery,
    release: mocks.clientRelease
  });
}

describe("call transcript job tenant isolation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getTranscriptProvider.mockReturnValue("managed_http");
    mocks.getTranscriptAiProvider.mockReturnValue("managed_http");
    mocks.dbQuery.mockResolvedValue({ rows: [] });
    setupClient();
  });

  it("locks transcript jobs only for the requested tenant", async () => {
    await lockPendingTranscriptJobs(5, 300, TENANT_ID);

    expect(mocks.clientQuery).toHaveBeenNthCalledWith(2, expect.stringContaining("tenant_id = $3"), [
      5,
      300,
      TENANT_ID
    ]);
  });

  it("retries transcript jobs only for the requested tenant", async () => {
    await retryFailedTranscriptJobs({ limit: 500, tenantId: TENANT_ID });

    expect(mocks.clientQuery).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("AND tenant_id = $2"),
      [100, TENANT_ID]
    );
  });

  it("locks transcript AI jobs only for the requested tenant", async () => {
    await lockPendingTranscriptAiJobs(5, 300, TENANT_ID);

    expect(mocks.clientQuery).toHaveBeenNthCalledWith(2, expect.stringContaining("tenant_id = $3"), [
      5,
      300,
      TENANT_ID
    ]);
  });

  it("retries transcript AI jobs only for the requested tenant", async () => {
    await retryFailedTranscriptAiJobs({ limit: 500, tenantId: TENANT_ID });

    expect(mocks.clientQuery).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("AND tenant_id = $2"),
      [100, TENANT_ID]
    );
  });

  it("lists failed transcript AI jobs only for the requested tenant", async () => {
    await listFailedTranscriptAiJobs(30, TENANT_ID);

    expect(mocks.dbQuery).toHaveBeenCalledWith(expect.stringContaining("AND tenant_id = $2"), [
      30,
      TENANT_ID
    ]);
  });
});
