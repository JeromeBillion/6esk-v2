import { z } from "zod";
import { attachCallRecording } from "@/server/calls/service";
import { authorizeCallWebhook } from "@/server/calls/webhook";
import { recordPlatformAuditLog } from "@/server/audit";
import {
  integrationError,
  integrationSuccess,
  validateIntegrationApiVersion
} from "@/server/api-contract";
import { runInBackground } from "@/server/async";

const callRecordingSchema = z.object({
  callSessionId: z.string().uuid().optional().nullable(),
  provider: z.string().optional().nullable(),
  providerCallId: z.string().optional().nullable(),
  recordingUrl: z.string().url(),
  durationSeconds: z.number().optional().nullable(),
  timestamp: z.union([z.string(), z.number()]).optional().nullable(),
  payload: z.record(z.unknown()).optional().nullable()
});

function parseTimestamp(value: string | number | null | undefined) {
  if (value == null) return null;
  if (typeof value === "number") {
    return new Date(value < 1e12 ? value * 1000 : value);
  }
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^\d+$/.test(trimmed)) {
    const numeric = Number(trimmed);
    return new Date(numeric < 1e12 ? numeric * 1000 : numeric);
  }
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export async function POST(request: Request) {
  const versionError = validateIntegrationApiVersion(request);
  if (versionError) {
    return versionError;
  }

  const rawBody = await request.text();
  const authorization = authorizeCallWebhook({
    rawBody,
    providedSignature:
      request.headers.get("x-6esk-signature") ?? request.headers.get("x-call-signature"),
    providedSecret: request.headers.get("x-6esk-secret"),
    providedTimestamp:
      request.headers.get("x-6esk-timestamp") ?? request.headers.get("x-call-timestamp")
  });

  if (!authorization.authorized) {
    runInBackground(recordPlatformAuditLog({
      action: "call_webhook_rejected",
      entityType: "call_webhook",
      data: {
        endpoint: "/api/calls/recording",
        mode: authorization.mode,
        reason: authorization.reason
      }
    }), "Failed to record rejected call recording webhook audit event");
    return integrationError(request, {
      status: 401,
      code: "unauthorized",
      message: "Unauthorized"
    });
  }

  let payload: unknown;
  try {
    payload = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    return integrationError(request, {
      status: 400,
      code: "invalid_json",
      message: "Invalid JSON body"
    });
  }

  const parsed = callRecordingSchema.safeParse(payload);
  if (!parsed.success) {
    return integrationError(request, {
      status: 400,
      code: "invalid_payload",
      message: "Invalid payload",
      details: parsed.error.flatten()
    });
  }

  const data = parsed.data;
  if (!data.callSessionId && !data.providerCallId) {
    return integrationError(request, {
      status: 400,
      code: "missing_call_identifier",
      message: "callSessionId or providerCallId is required"
    });
  }

  const occurredAt = parseTimestamp(data.timestamp);
  const result = await attachCallRecording({
    callSessionId: data.callSessionId ?? null,
    provider: data.provider ?? null,
    providerCallId: data.providerCallId ?? null,
    recordingUrl: data.recordingUrl,
    durationSeconds: data.durationSeconds ?? null,
    occurredAt: occurredAt ?? undefined,
    payload: (data.payload as Record<string, unknown> | null) ?? null
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
