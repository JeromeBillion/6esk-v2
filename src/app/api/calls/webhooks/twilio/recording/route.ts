import { recordAuditLog } from "@/server/audit";
import { attachCallRecording, resolveCallSessionProviderScope } from "@/server/calls/service";
import { normalizeTwilioParams, validateTwilioWebhookForTenant } from "@/server/calls/twilio";
import {
  ProviderWebhookSecretConfigurationError,
  shouldRequireTenantProviderWebhookSecrets
} from "@/server/provider-webhook-secrets";

function parseTimestamp(value: string | null | undefined) {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^\d+$/.test(trimmed)) {
    const numeric = Number(trimmed);
    return new Date(numeric < 1e12 ? numeric * 1000 : numeric);
  }
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseDurationSeconds(value: string | null | undefined) {
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.floor(parsed);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const params = normalizeTwilioParams(url.searchParams);
  const providerCallId = params.CallSid?.trim() || null;
  if (!providerCallId) {
    return Response.json({ error: "CallSid is required" }, { status: 400 });
  }

  const scope = await resolveCallSessionProviderScope({
    provider: "twilio",
    providerCallId
  });
  if (!scope && shouldRequireTenantProviderWebhookSecrets()) {
    void recordAuditLog({
      action: "call_webhook_rejected",
      entityType: "call_webhook",
      data: {
        endpoint: "/api/calls/webhooks/twilio/recording",
        mode: "twilio_signature",
        reason: "unresolved_call_provider_route",
        callSid: providerCallId
      }
    }).catch(() => {});
    return Response.json(
      { error: "Call session not found", code: "unresolved_call_provider_route" },
      { status: 404 }
    );
  }

  let verification: Awaited<ReturnType<typeof validateTwilioWebhookForTenant>>;
  try {
    verification = await validateTwilioWebhookForTenant({
      scope,
      providerAccountId: params.AccountSid ?? null,
      pathname: "/api/calls/webhooks/twilio/recording",
      requestUrl: request.url,
      signature: request.headers.get("x-twilio-signature"),
      params
    });
  } catch (error) {
    if (error instanceof ProviderWebhookSecretConfigurationError) {
      return Response.json(
        {
          error: error.message,
          code: "provider_webhook_secret_configuration_missing"
        },
        { status: 503 }
      );
    }
    throw error;
  }

  if (verification.missingSecret) {
    return Response.json(
      {
        error: "Provider webhook secret is not configured for this tenant.",
        code: "provider_webhook_secret_missing"
      },
      { status: 503 }
    );
  }

  if (!verification.valid) {
    void recordAuditLog({
      action: "call_webhook_rejected",
      entityType: "call_webhook",
      data: {
        endpoint: "/api/calls/webhooks/twilio/recording",
        mode: "twilio_signature",
        reason: "invalid_signature"
      }
    }).catch(() => {});
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const recordingUrl = params.RecordingUrl?.trim() || null;
  if (!recordingUrl) {
    return Response.json({ status: "ignored", reason: "missing_recording_url" });
  }

  const result = await attachCallRecording({
    provider: "twilio",
    providerCallId,
    recordingUrl,
    durationSeconds: parseDurationSeconds(params.RecordingDuration),
    occurredAt: parseTimestamp(params.Timestamp) ?? undefined,
    payload: {
      source: "twilio",
      recordingSid: params.RecordingSid ?? null,
      recordingStatus: params.RecordingStatus ?? null
    }
  });

  if (result.status === "not_found") {
    return Response.json({ error: "Call session not found" }, { status: 404 });
  }
  if (result.status === "failed") {
    return Response.json({ error: result.detail }, { status: 400 });
  }

  return Response.json(result);
}
