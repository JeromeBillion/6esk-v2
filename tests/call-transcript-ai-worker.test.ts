import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getObjectBuffer: vi.fn(),
  getTranscriptAiProvider: vi.fn(),
  submitTranscriptAiJob: vi.fn(),
  getProcessingRecoverySeconds: vi.fn(),
  lockPendingTranscriptAiJobs: vi.fn(),
  markTranscriptAiJobCompleted: vi.fn(),
  markTranscriptAiJobFailed: vi.fn(),
  recordAuditLog: vi.fn()
}));

vi.mock("@/server/storage/r2", () => ({
  getObjectBuffer: mocks.getObjectBuffer
}));

vi.mock("@/server/calls/transcript-ai-provider", () => ({
  getTranscriptAiProvider: mocks.getTranscriptAiProvider,
  submitTranscriptAiJob: mocks.submitTranscriptAiJob
}));

vi.mock("@/server/calls/transcript-ai-jobs", () => ({
  getProcessingRecoverySeconds: mocks.getProcessingRecoverySeconds,
  lockPendingTranscriptAiJobs: mocks.lockPendingTranscriptAiJobs,
  markTranscriptAiJobCompleted: mocks.markTranscriptAiJobCompleted,
  markTranscriptAiJobFailed: mocks.markTranscriptAiJobFailed
}));

vi.mock("@/server/audit", () => ({
  recordAuditLog: mocks.recordAuditLog
}));

import { deliverPendingTranscriptAiJobs } from "@/server/calls/transcript-ai-worker";

describe("deliverPendingTranscriptAiJobs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getTranscriptAiProvider.mockReturnValue("managed_http");
    mocks.getProcessingRecoverySeconds.mockReturnValue(300);
    mocks.lockPendingTranscriptAiJobs.mockResolvedValue([]);
    mocks.recordAuditLog.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("submits transcript analysis jobs and marks them complete", async () => {
    mocks.lockPendingTranscriptAiJobs.mockResolvedValue([
      {
        id: "job-1",
        call_session_id: "11111111-1111-1111-1111-111111111111",
        provider: "managed_http",
        transcript_r2_key: "messages/msg/transcript.txt",
        metadata: { ticketId: "ticket-1" },
        attempt_count: 0
      }
    ]);
    mocks.getObjectBuffer.mockResolvedValue({
      buffer: Buffer.from("Customer asked for a refund and escalation.", "utf8"),
      contentType: "text/plain"
    });
    mocks.submitTranscriptAiJob.mockResolvedValue({
      status: "completed",
      providerJobId: "provider-job-1",
      qaStatus: "review",
      summary: "Customer asked for a refund and escalation.",
      resolutionNote: "Supervisor should review the call before closing the issue.",
      qaFlags: [
        {
          code: "refund_escalation",
          severity: "high",
          title: "Refund escalation",
          detail: "The call contains both a refund request and escalation language.",
          evidence: "refund and escalation"
        }
      ],
      actionItems: [
        {
          owner: "supervisor",
          priority: "high",
          description: "Review the call before resolution."
        }
      ],
      rawResponse: { provider: "openai" }
    });

    const result = await deliverPendingTranscriptAiJobs({ limit: 1 });

    expect(result).toMatchObject({
      delivered: 1,
      skipped: 0,
      provider: "managed_http"
    });
    expect(mocks.lockPendingTranscriptAiJobs).toHaveBeenCalledWith(1, 300);
    expect(mocks.submitTranscriptAiJob).toHaveBeenCalledWith(
      "managed_http",
      expect.objectContaining({
        jobId: "job-1",
        callSessionId: "11111111-1111-1111-1111-111111111111",
        transcriptR2Key: "messages/msg/transcript.txt",
        transcriptText: "Customer asked for a refund and escalation.",
        metadata: { ticketId: "ticket-1" }
      })
    );
    expect(mocks.markTranscriptAiJobCompleted).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: "job-1",
        qaStatus: "review",
        summary: "Customer asked for a refund and escalation."
      })
    );
    expect(mocks.markTranscriptAiJobFailed).not.toHaveBeenCalled();
  });

  it("marks transcript analysis jobs failed and records audit when provider throws", async () => {
    mocks.lockPendingTranscriptAiJobs.mockResolvedValue([
      {
        id: "job-2",
        call_session_id: "22222222-2222-2222-2222-222222222222",
        provider: "managed_http",
        transcript_r2_key: "messages/msg/transcript.txt",
        metadata: {},
        attempt_count: 2
      }
    ]);
    mocks.getObjectBuffer.mockResolvedValue({
      buffer: Buffer.from("Transcript text", "utf8"),
      contentType: "text/plain"
    });
    mocks.submitTranscriptAiJob.mockRejectedValue(new Error("provider unavailable"));

    const result = await deliverPendingTranscriptAiJobs({ limit: 1 });

    expect(result).toMatchObject({
      delivered: 0,
      skipped: 1,
      provider: "managed_http"
    });
    expect(mocks.markTranscriptAiJobFailed).toHaveBeenCalledWith({
      jobId: "job-2",
      attemptCount: 3,
      errorMessage: "provider unavailable"
    });
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "call_transcript_ai_job_failed",
        entityId: "job-2"
      })
    );
  });
});
