import { recordAuditLog } from "@/server/audit";
import { attachCallRecording } from "@/server/calls/service";
import { normalizeTwilioParams, validateTwilioWebhook } from "@/server/calls/twilio";
import {
  integrationError,
  integrationSuccess,
  validateIntegrationApiVersion
} from "@/server/api-contract";
import { runInBackground } from "@/server/async";

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
  const versionError = validateIntegrationApiVersion(request);
  if (versionError) {
    return versionError;
  }

  const url = new URL(request.url);
  const params = normalizeTwilioParams(url.searchParams);
  const isValid = validateTwilioWebhook({
    pathname: "/api/calls/webhooks/twilio/recording",
    requestUrl: request.url,
    signature: request.headers.get("x-twilio-signature"),
    params: {}
  });

  if (!isValid) {
    runInBackground(recordAuditLog({
      action: "call_webhook_rejected",
      entityType: "call_webhook",
      data: {
        endpoint: "/api/calls/webhooks/twilio/recording",
        mode: "twilio_signature",
        reason: "invalid_signature"
      }
    }), "Failed to record rejected Twilio recording webhook audit event");
    return integrationError(request, {
      status: 401,
      code: "unauthorized",
      message: "Unauthorized"
    });
  }

  const providerCallId = params.CallSid?.trim() || null;
  const recordingUrl = params.RecordingUrl?.trim() || null;
  if (!providerCallId) {
    return integrationError(request, {
      status: 400,
      code: "missing_call_sid",
      message: "CallSid is required"
    });
  }
  if (!recordingUrl) {
    return integrationSuccess(request, { status: "ignored", reason: "missing_recording_url" });
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
    return integrationError(request, {
      status: 404,
      code: "call_session_not_found",
      message: "Call session not found"
    });
  }
  if (result.status === "failed") {
    return integrationError(request, {
      status: 400,
      code: "recording_attach_failed",
      message: result.detail
    });
  }

  return integrationSuccess(request, result);
}
