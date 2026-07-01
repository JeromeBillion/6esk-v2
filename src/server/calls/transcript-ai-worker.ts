import { getObjectBuffer } from "@/server/storage/r2";
import { recordAuditLog } from "@/server/audit";
import { getTranscriptAiProvider, submitTranscriptAiJob } from "@/server/calls/transcript-ai-provider";
import {
  listActiveProviderWebhookSecrets,
  shouldRequireTenantProviderWebhookSecrets
} from "@/server/provider-webhook-secrets";
import { DEFAULT_WORKSPACE_KEY } from "@/server/workspace-modules";
import { logger } from "@/server/logger";
import {
  getProcessingRecoverySeconds,
  lockPendingTranscriptAiJobs,
  markTranscriptAiJobCompleted,
  markTranscriptAiJobFailed
} from "@/server/calls/transcript-ai-jobs";

function readEnvTranscriptAiHttpSecret() {
  return (
    process.env.CALLS_TRANSCRIPT_AI_PROVIDER_HTTP_SECRET?.trim() ||
    process.env.CALLS_STT_PROVIDER_HTTP_SECRET?.trim() ||
    null
  );
}

async function getScopedTranscriptAiHttpSecret(tenantId: string) {
  const scope = { tenantId, workspaceKey: DEFAULT_WORKSPACE_KEY };
  const secrets = await listActiveProviderWebhookSecrets({
    scope,
    provider: "managed_ai",
    secretType: "http_secret"
  });
  if (secrets[0]) {
    return secrets[0].secret;
  }

  if (!shouldRequireTenantProviderWebhookSecrets()) {
    return readEnvTranscriptAiHttpSecret();
  }

  throw new Error("Provider webhook secret missing for managed_ai/http_secret.");
}

export async function deliverPendingTranscriptAiJobs({
  limit = 5,
  tenantId
}: {
  limit?: number;
  tenantId: string;
}) {
  const provider = getTranscriptAiProvider();
  const scopedTenantId = tenantId.trim();
  if (!scopedTenantId) {
    throw new Error("Transcript AI outbox delivery requires tenantId");
  }
  const pending = await lockPendingTranscriptAiJobs(limit, getProcessingRecoverySeconds(), scopedTenantId);
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
        providerHttpSecret:
          provider === "managed_http"
            ? await getScopedTranscriptAiHttpSecret(job.tenant_id)
            : null,
        metadata: {
          ...(job.metadata ?? {}),
          tenantId: job.tenant_id
        }
      });

      await markTranscriptAiJobCompleted({
        jobId: job.id,
        tenantId: job.tenant_id,
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
        tenantId: job.tenant_id,
        attemptCount: job.attempt_count + 1,
        errorMessage: detail
      });
      try {
        await recordAuditLog({
          tenantId: job.tenant_id,
          action: "call_transcript_ai_job_failed",
          entityType: "call_transcript_ai_jobs",
          entityId: job.id,
          data: {
            provider,
            callSessionId: job.call_session_id,
            detail
          }
        });
      } catch (auditError) {
        logger.warn("Failed to record transcript AI job failure audit event", {
          error: auditError,
          tenantId: job.tenant_id,
          jobId: job.id,
          callSessionId: job.call_session_id
        });
      }
    }
  }

  return { delivered, skipped: pending.length - delivered, provider };
}
