import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getTranscriptProvider: vi.fn(),
  submitTranscriptJob: vi.fn(),
  getProcessingRecoverySeconds: vi.fn(),
  lockPendingTranscriptJobs: vi.fn(),
  markTranscriptJobFailed: vi.fn(),
  markTranscriptJobSubmitted: vi.fn(),
  attachCallTranscript: vi.fn(),
  recordAuditLog: vi.fn()
}));

vi.mock("@/server/calls/stt-provider", () => ({
  getTranscriptProvider: mocks.getTranscriptProvider,
  submitTranscriptJob: mocks.submitTranscriptJob
}));

vi.mock("@/server/calls/transcript-jobs", () => ({
  getProcessingRecoverySeconds: mocks.getProcessingRecoverySeconds,
  lockPendingTranscriptJobs: mocks.lockPendingTranscriptJobs,
  markTranscriptJobFailed: mocks.markTranscriptJobFailed,
  markTranscriptJobSubmitted: mocks.markTranscriptJobSubmitted
}));

vi.mock("@/server/calls/service", () => ({
  attachCallTranscript: mocks.attachCallTranscript
}));

vi.mock("@/server/audit", () => ({
  recordAuditLog: mocks.recordAuditLog
}));

import { deliverPendingTranscriptJobs } from "@/server/calls/transcript-worker";

const ORIGINAL_ENV = { ...process.env };

describe("deliverPendingTranscriptJobs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = {
      ...ORIGINAL_ENV,
      APP_URL: "https://app.6esk.test",
      CALLS_TRANSCRIPT_SHARED_SECRET: "transcript-secret"
    };
    mocks.getTranscriptProvider.mockReturnValue("managed_http");
    mocks.getProcessingRecoverySeconds.mockReturnValue(300);
    mocks.lockPendingTranscriptJobs.mockResolvedValue([]);
    mocks.recordAuditLog.mockResolvedValue(undefined);
    mocks.attachCallTranscript.mockResolvedValue({
      status: "attached",
      callSessionId: "11111111-1111-1111-1111-111111111111",
      transcriptR2Key: "messages/msg/transcript.txt",
      attachmentId: "22222222-2222-2222-2222-222222222222"
    });
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("submits completed transcript jobs and attaches the transcript", async () => {
    mocks.lockPendingTranscriptJobs.mockResolvedValue([
      {
        id: "job-1",
        call_session_id: "11111111-1111-1111-1111-111111111111",
        provider: "managed_http",
        recording_r2_key: "messages/msg/recording.mp3",
        metadata: { source: "recording_ready" },
        attempt_count: 0
      }
    ]);
    mocks.submitTranscriptJob.mockResolvedValue({
      status: "completed",
      providerJobId: "provider-job-1",
      transcriptText: "Resolved customer billing query."
    });

    const result = await deliverPendingTranscriptJobs({ limit: 1 });

    expect(result).toMatchObject({
      delivered: 1,
      skipped: 0,
      provider: "managed_http"
    });
    expect(mocks.lockPendingTranscriptJobs).toHaveBeenCalledWith(1, 300);
    expect(mocks.submitTranscriptJob).toHaveBeenCalledWith(
      "managed_http",
      expect.objectContaining({
        jobId: "job-1",
        callSessionId: "11111111-1111-1111-1111-111111111111",
        recordingR2Key: "messages/msg/recording.mp3",
        callbackUrl: "https://app.6esk.test/api/calls/transcript",
        callbackSecret: "transcript-secret",
        metadata: { source: "recording_ready" }
      })
    );
    expect(mocks.attachCallTranscript).toHaveBeenCalledWith(
      expect.objectContaining({
        callSessionId: "11111111-1111-1111-1111-111111111111",
        provider: "managed_http",
        transcriptText: "Resolved customer billing query.",
        payload: {
          source: "stt_job",
          jobId: "job-1",
          providerJobId: "provider-job-1"
        }
      })
    );
    expect(mocks.markTranscriptJobSubmitted).not.toHaveBeenCalled();
    expect(mocks.markTranscriptJobFailed).not.toHaveBeenCalled();
  });

  it("marks accepted provider jobs as submitted for callback completion", async () => {
    mocks.lockPendingTranscriptJobs.mockResolvedValue([
      {
        id: "job-2",
        call_session_id: "33333333-3333-3333-3333-333333333333",
        provider: "managed_http",
        recording_r2_key: "messages/msg/recording.mp3",
        metadata: {},
        attempt_count: 1
      }
    ]);
    mocks.submitTranscriptJob.mockResolvedValue({
      status: "accepted",
      providerJobId: "provider-job-2"
    });

    const result = await deliverPendingTranscriptJobs({ limit: 1 });

    expect(result).toMatchObject({
      delivered: 1,
      skipped: 0,
      provider: "managed_http"
    });
    expect(mocks.markTranscriptJobSubmitted).toHaveBeenCalledWith({
      jobId: "job-2",
      attemptCount: 2,
      providerJobId: "provider-job-2"
    });
    expect(mocks.attachCallTranscript).not.toHaveBeenCalled();
    expect(mocks.markTranscriptJobFailed).not.toHaveBeenCalled();
  });
});
