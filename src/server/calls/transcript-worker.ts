import { recordAuditLog } from "@/server/audit";
import { attachCallTranscript } from "@/server/calls/service";
import { getTranscriptProvider, submitTranscriptJob } from "@/server/calls/stt-provider";
import {
  listActiveProviderWebhookSecrets,
  shouldRequireTenantProviderWebhookSecrets
} from "@/server/provider-webhook-secrets";
import { DEFAULT_WORKSPACE_KEY } from "@/server/workspace-modules";
import { logger } from "@/server/logger";
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
  const deepgram = process.env.CALLS_STT_DEEPGRAM_CALLBACK_TOKEN?.trim();
  if (deepgram) return deepgram;
  const explicit = process.env.CALLS_TRANSCRIPT_SHARED_SECRET?.trim();
  if (explicit) return explicit;
  const inbound = process.env.INBOUND_SHARED_SECRET?.trim();
  return inbound || null;
}

async function getScopedProviderSecret({
  tenantId,
  provider,
  secretType,
  fallbackEnv
}: {
  tenantId: string;
  provider: string;
  secretType: string;
  fallbackEnv?: string;
}) {
  const scope = { tenantId, workspaceKey: DEFAULT_WORKSPACE_KEY };
  const secrets = await listActiveProviderWebhookSecrets({
    scope,
    provider,
    secretType
  });
  if (secrets[0]) {
    return secrets[0].secret;
  }

  if (!shouldRequireTenantProviderWebhookSecrets() && fallbackEnv) {
    return process.env[fallbackEnv]?.trim() || null;
  }

  if (shouldRequireTenantProviderWebhookSecrets()) {
    throw new Error(`Provider webhook secret missing for ${provider}/${secretType}.`);
  }

  return null;
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
        callbackSecret:
          provider === "managed_http"
            ? (await getScopedProviderSecret({
                tenantId: job.tenant_id,
                provider: "deepgram",
                secretType: "callback_token",
                fallbackEnv: "CALLS_STT_DEEPGRAM_CALLBACK_TOKEN"
              })) ?? callbackSecret
            : callbackSecret,
        providerHttpSecret:
          provider === "managed_http"
            ? await getScopedProviderSecret({
                tenantId: job.tenant_id,
                provider: "managed_stt",
                secretType: "http_secret",
                fallbackEnv: "CALLS_STT_PROVIDER_HTTP_SECRET"
              })
            : null,
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
      try {
        await recordAuditLog({
          tenantId: job.tenant_id,
          action: "call_transcript_job_failed",
          entityType: "call_transcript_jobs",
          entityId: job.id,
          data: {
            provider,
            callSessionId: job.call_session_id,
            detail
          }
        });
      } catch (auditError) {
        logger.warn("Failed to record transcript job failure audit event", {
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
