import { getObjectBuffer } from "@/server/storage/r2";
import { recordAuditLog } from "@/server/audit";
import { getTranscriptAiProvider, submitTranscriptAiJob } from "@/server/calls/transcript-ai-provider";
import {
  getProcessingRecoverySeconds,
  lockPendingTranscriptAiJobs,
  markTranscriptAiJobCompleted,
  markTranscriptAiJobFailed
} from "@/server/calls/transcript-ai-jobs";

export async function deliverPendingTranscriptAiJobs({ limit = 5 }: { limit?: number } = {}) {
  const provider = getTranscriptAiProvider();
  const pending = await lockPendingTranscriptAiJobs(limit, getProcessingRecoverySeconds());
  if (!pending.length) {
    return { delivered: 0, skipped: 0, provider };
  }

  let delivered = 0;

  for (const job of pending) {
    try {
      const { buffer } = await getObjectBuffer(job.transcript_r2_key);
      const transcriptText = buffer.toString("utf8").trim();
      if (!transcriptText) {
        throw new Error("Transcript artifact is empty or unavailable.");
      }

      const result = await submitTranscriptAiJob(provider, {
        jobId: job.id,
        callSessionId: job.call_session_id,
        transcriptR2Key: job.transcript_r2_key,
        transcriptText,
        metadata: job.metadata ?? null
      });

      await markTranscriptAiJobCompleted({
        jobId: job.id,
        attemptCount: job.attempt_count + 1,
        providerJobId: result.providerJobId,
        qaStatus: result.qaStatus,
        summary: result.summary,
        resolutionNote: result.resolutionNote,
        qaFlags: result.qaFlags,
        actionItems: result.actionItems,
        rawResponse: result.rawResponse
      });

      delivered += 1;
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Transcript AI dispatch failed";
      await markTranscriptAiJobFailed({
        jobId: job.id,
        attemptCount: job.attempt_count + 1,
        errorMessage: detail
      });
      await recordAuditLog({
        action: "call_transcript_ai_job_failed",
        entityType: "call_transcript_ai_jobs",
        entityId: job.id,
        data: {
          provider,
          callSessionId: job.call_session_id,
          detail
        }
      }).catch(() => {});
    }
  }

  return { delivered, skipped: pending.length - delivered, provider };
}
