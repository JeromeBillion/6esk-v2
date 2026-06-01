import { recordAuditLog } from "@/server/audit";
import { attachCallTranscript } from "@/server/calls/service";
import { getTranscriptProvider, submitTranscriptJob } from "@/server/calls/stt-provider";
import {
  listActiveProviderWebhookSecrets,
  shouldRequireTenantProviderWebhookSecrets
} from "@/server/provider-webhook-secrets";
import {
  getProcessingRecoverySeconds,
  lockPendingTranscriptJobs,
  markTranscriptJobFailed,
  markTranscriptJobSubmitted
} from "@/server/calls/transcript-jobs";
import type { TenantScopeInput } from "@/server/tenant-context";
import { resolveTenantScope, type TenantScope } from "@/server/tenant-context";

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
  scope,
  provider,
  secretType,
  fallbackEnv
}: {
  scope: TenantScope;
  provider: string;
  secretType: string;
  fallbackEnv?: string;
}) {
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

export async function deliverPendingTranscriptJobs(
  { limit = 5 }: { limit?: number } = {},
  scopeInput?: TenantScopeInput
) {
  const provider = getTranscriptProvider();
  const pending = await lockPendingTranscriptJobs(limit, getProcessingRecoverySeconds(), scopeInput);
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
      const jobScope = resolveTenantScope({
        tenantKey: job.tenant_key,
        workspaceKey: job.workspace_key
      });
      const callbackSecret =
        provider === "managed_http"
          ? (await getScopedProviderSecret({
              scope: jobScope,
              provider: "deepgram",
              secretType: "callback_token",
              fallbackEnv: "CALLS_STT_DEEPGRAM_CALLBACK_TOKEN"
            })) ?? getTranscriptCallbackSecret()
          : getTranscriptCallbackSecret();
      const providerHttpSecret =
        provider === "managed_http"
          ? await getScopedProviderSecret({
              scope: jobScope,
              provider: "managed_stt",
              secretType: "http_secret",
              fallbackEnv: "CALLS_STT_PROVIDER_HTTP_SECRET"
            })
          : null;
      const result = await submitTranscriptJob(provider, {
        jobId: job.id,
        callSessionId: job.call_session_id,
        recordingR2Key: job.recording_r2_key,
        callbackUrl,
        callbackSecret,
        providerHttpSecret,
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
          scope: jobScope,
          attemptCount: job.attempt_count + 1,
          providerJobId: result.providerJobId
        });
      }

      delivered += 1;
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Transcript dispatch failed";
      await markTranscriptJobFailed({
        jobId: job.id,
        scope: {
          tenantKey: job.tenant_key,
          workspaceKey: job.workspace_key
        },
        attemptCount: job.attempt_count + 1,
        errorMessage: detail
      });
      await recordAuditLog({
        tenantKey: job.tenant_key,
        workspaceKey: job.workspace_key,
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
