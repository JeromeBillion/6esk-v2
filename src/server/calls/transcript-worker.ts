import { recordAuditLog } from "@/server/audit";
import { attachCallTranscript } from "@/server/calls/service";
import { getTranscriptProvider, submitTranscriptJob } from "@/server/calls/stt-provider";
import {
  getProcessingRecoverySeconds,
  lockPendingTranscriptJobs,
  markTranscriptJobFailed,
  markTranscriptJobSubmitted
} from "@/server/calls/transcript-jobs";

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

function buildCallbackUrl(appUrl: string, path: string) {
  return `${trimTrailingSlash(appUrl)}${path}`;
}

function getTranscriptCallbackSecret() {
  const explicit = process.env.CALLS_TRANSCRIPT_SHARED_SECRET?.trim();
  if (explicit) return explicit;
  const inbound = process.env.INBOUND_SHARED_SECRET?.trim();
  return inbound || null;
}

export async function deliverPendingTranscriptJobs({ limit = 5 }: { limit?: number } = {}) {
  const provider = getTranscriptProvider();
  const pending = await lockPendingTranscriptJobs(limit, getProcessingRecoverySeconds());
  if (!pending.length) {
    return { delivered: 0, skipped: 0, provider };
  }

  const appUrl = process.env.APP_URL?.trim();
  if (!appUrl) {
    throw new Error("APP_URL is required for transcript callbacks.");
  }

  let delivered = 0;
  const callbackUrl = buildCallbackUrl(appUrl, "/api/calls/transcript");
  const callbackSecret = getTranscriptCallbackSecret();

  for (const job of pending) {
    try {
      const result = await submitTranscriptJob(provider, {
        jobId: job.id,
        callSessionId: job.call_session_id,
        recordingR2Key: job.recording_r2_key,
        callbackUrl,
        callbackSecret,
        metadata: job.metadata ?? null
      });

      if (result.status === "completed") {
        const attachResult = await attachCallTranscript({
          callSessionId: job.call_session_id,
          provider,
          transcriptText: result.transcriptText,
          payload: {
            source: "stt_job",
            jobId: job.id,
            providerJobId: result.providerJobId
          }
        });

        if (attachResult.status !== "attached") {
          throw new Error(
            attachResult.status === "failed"
              ? attachResult.detail
              : "Call session not found for transcript attachment."
          );
        }
      } else {
        await markTranscriptJobSubmitted({
          jobId: job.id,
          attemptCount: job.attempt_count + 1,
          providerJobId: result.providerJobId
        });
      }

      delivered += 1;
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Transcript dispatch failed";
      await markTranscriptJobFailed({
        jobId: job.id,
        attemptCount: job.attempt_count + 1,
        errorMessage: detail
      });
      await recordAuditLog({
        action: "call_transcript_job_failed",
        entityType: "call_transcript_jobs",
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
