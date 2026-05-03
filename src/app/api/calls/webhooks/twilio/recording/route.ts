import { recordAuditLog } from "@/server/audit";
import { attachCallRecording } from "@/server/calls/service";
import { normalizeTwilioParams, validateTwilioWebhook } from "@/server/calls/twilio";

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
  const isValid = validateTwilioWebhook({
    pathname: "/api/calls/webhooks/twilio/recording",
    requestUrl: request.url,
    signature: request.headers.get("x-twilio-signature"),
    params: {}
  });

  if (!isValid) {
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

  const providerCallId = params.CallSid?.trim() || null;
  const recordingUrl = params.RecordingUrl?.trim() || null;
  if (!providerCallId) {
    return Response.json({ error: "CallSid is required" }, { status: 400 });
  }
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
