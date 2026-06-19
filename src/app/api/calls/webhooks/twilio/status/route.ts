import { recordPlatformAuditLog } from "@/server/audit";
import {
  mapTwilioCallStatus,
  normalizeTwilioParams,
  validateTwilioWebhookForTenant
} from "@/server/calls/twilio";
import { resolveCallSessionProviderScope, updateCallSessionStatus } from "@/server/calls/service";
import {
  integrationError,
  integrationSuccess,
  validateIntegrationApiVersion
} from "@/server/api-contract";
import { runInBackground } from "@/server/async";
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
  const versionError = validateIntegrationApiVersion(request);
  if (versionError) {
    return versionError;
  }

  const url = new URL(request.url);
  const params = normalizeTwilioParams(url.searchParams);
  const providerCallId = params.CallSid?.trim() || null;
  if (!providerCallId) {
    return integrationError(request, {
      status: 400,
      code: "missing_call_sid",
      message: "CallSid is required"
    });
  }

  const scope = await resolveCallSessionProviderScope({
    provider: "twilio",
    providerCallId
  });
  if (!scope && shouldRequireTenantProviderWebhookSecrets()) {
    runInBackground(recordPlatformAuditLog({
      action: "call_webhook_rejected",
      entityType: "call_webhook",
      data: {
        endpoint: "/api/calls/webhooks/twilio/status",
        mode: "twilio_signature",
        reason: "unresolved_call_provider_route",
        callSid: providerCallId
      }
    }), "Failed to record rejected Twilio status webhook audit event");
    return integrationError(request, {
      status: 404,
      code: "unresolved_call_provider_route",
      message: "Call session not found"
    });
  }

  let verification: Awaited<ReturnType<typeof validateTwilioWebhookForTenant>>;
  try {
    verification = await validateTwilioWebhookForTenant({
      scope,
      providerAccountId: params.AccountSid ?? null,
      pathname: "/api/calls/webhooks/twilio/status",
      requestUrl: request.url,
      signature: request.headers.get("x-twilio-signature"),
      params: {}
    });
  } catch (error) {
    if (error instanceof ProviderWebhookSecretConfigurationError) {
      return integrationError(request, {
        status: 503,
        code: "provider_webhook_secret_configuration_missing",
        message: error.message
      });
    }
    throw error;
  }

  if (verification.missingSecret) {
    return integrationError(request, {
      status: 503,
      code: "provider_webhook_secret_missing",
      message: "Provider webhook secret is not configured for this tenant."
    });
  }

  if (!verification.valid) {
    runInBackground(recordPlatformAuditLog({
      action: "call_webhook_rejected",
      entityType: "call_webhook",
      data: {
        endpoint: "/api/calls/webhooks/twilio/status",
        mode: "twilio_signature",
        reason: "invalid_signature"
      }
    }), "Failed to record rejected Twilio status webhook audit event");
    return integrationError(request, {
      status: 401,
      code: "unauthorized",
      message: "Unauthorized"
    });
  }

  const status = mapTwilioCallStatus(params.CallStatus);
  if (!status) {
    return integrationSuccess(request, { status: "ignored" });
  }

  const result = await updateCallSessionStatus({
    provider: "twilio",
    providerCallId,
    status,
    occurredAt: parseTimestamp(params.Timestamp) ?? undefined,
    durationSeconds: parseDurationSeconds(params.CallDuration),
    payload: {
      source: "twilio",
      callStatus: params.CallStatus ?? null,
      direction: params.Direction ?? null,
      answeredBy: params.AnsweredBy ?? null,
      callSid: providerCallId
    }
  });

  if (result.status === "not_found") {
    return integrationError(request, {
      status: 404,
      code: "call_session_not_found",
      message: "Call session not found"
    });
  }

  return integrationSuccess(request, result);
}
