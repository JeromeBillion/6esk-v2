import {
  markVoiceOperatorQueueOutcome,
  reserveNextVoiceDeskOperatorForCall
} from "@/server/calls/operators";
import {
  buildDeskOperatorDialTwiML,
  buildHoldAndRetryTwiML,
  buildUnavailableTwiML,
  buildVoiceResponse,
  parseQueuedOperatorIds,
  shouldContinueVoiceQueue
} from "@/server/calls/twilio-queue";
import {
  buildTwilioPublicUrl,
  normalizeTwilioParams,
  validateTwilioWebhookForTenant
} from "@/server/calls/twilio";
import { recordPlatformAuditLog } from "@/server/audit";
import {
  integrationError,
  validateIntegrationApiVersion
} from "@/server/api-contract";
import { runInBackground } from "@/server/async";
import { resolveCallSessionProviderScope } from "@/server/calls/service";
import {
  ProviderWebhookSecretConfigurationError,
  shouldRequireTenantProviderWebhookSecrets
} from "@/server/provider-webhook-secrets";

function readString(value: FormDataEntryValue | string | null | undefined) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function buildHangupTwiML() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Hangup />
</Response>`;
}

export async function POST(request: Request) {
  const versionError = validateIntegrationApiVersion(request);
  if (versionError) {
    return versionError;
  }

  const formData = await request.formData();
  const params = normalizeTwilioParams(
    new URLSearchParams(
      Array.from(formData.entries()).flatMap(([key, value]) =>
        typeof value === "string" ? [[key, value]] : []
      )
    )
  );

  const requestParams = new URL(request.url).searchParams;
  const callSessionId = readString(requestParams.get("callSessionId"));
  const operatorUserId = readString(requestParams.get("operatorUserId"));
  const attempt = Number(requestParams.get("attempt") ?? "0");
  const offeredUserIds = parseQueuedOperatorIds(requestParams.get("offered"));
  const dialStatus = readString(formData.get("DialCallStatus"));
  const parentFromPhone = readString(formData.get("From"));
  const parentToPhone = readString(formData.get("To"));

  if (!callSessionId || !operatorUserId) {
    return integrationError(request, {
      status: 400,
      code: "missing_queue_fields",
      message: "callSessionId and operatorUserId are required"
    });
  }

  const scope = await resolveCallSessionProviderScope({ callSessionId });
  if (!scope && shouldRequireTenantProviderWebhookSecrets()) {
    runInBackground(recordPlatformAuditLog({
      action: "call_webhook_rejected",
      entityType: "call_webhook",
      data: {
        endpoint: "/api/calls/webhooks/twilio/voice/queue",
        mode: "twilio_signature",
        reason: "unresolved_call_provider_route",
        callSessionId
      }
    }), "Failed to record rejected Twilio queue webhook audit event");
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
      pathname: "/api/calls/webhooks/twilio/voice/queue",
      requestUrl: request.url,
      signature: request.headers.get("x-twilio-signature"),
      params
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
        endpoint: "/api/calls/webhooks/twilio/voice/queue",
        mode: "twilio_signature",
        reason: "invalid_signature"
      }
    }), "Failed to record rejected Twilio queue webhook audit event");
    return integrationError(request, {
      status: 401,
      code: "unauthorized",
      message: "Unauthorized"
    });
  }

  if (operatorUserId) {
    const outcome = shouldContinueVoiceQueue(dialStatus) ? "missed" : "connected";
    await markVoiceOperatorQueueOutcome({
      userId: operatorUserId,
      callSessionId,
      outcome
    });
  }

  if (!shouldContinueVoiceQueue(dialStatus)) {
    return buildVoiceResponse(buildHangupTwiML());
  }

  const exhaustedOperators = Array.from(new Set([...offeredUserIds, operatorUserId]));
  const operator = await reserveNextVoiceDeskOperatorForCall({
    callSessionId,
    excludeUserIds: exhaustedOperators
  });

  if (!operator) {
    const retryLimit = Math.max(
      0,
      Number.parseInt(process.env.CALLS_TWILIO_QUEUE_RETRY_LIMIT ?? "6", 10) || 6
    );
    if (attempt < retryLimit) {
      return buildVoiceResponse(
        buildHoldAndRetryTwiML({
          requestUrl: request.url,
          attempt
        })
      );
    }
    return buildVoiceResponse(buildUnavailableTwiML());
  }

  const recordingCallback = buildTwilioPublicUrl("/api/calls/webhooks/twilio/recording", request.url);
  const twiml = buildDeskOperatorDialTwiML({
    requestUrl: request.url,
    target: {
      type: "client",
      identity: operator.identity,
      parameters: {
        callSessionId,
        direction: "inbound",
        fromPhone: parentFromPhone,
        toPhone: parentToPhone,
        operatorUserId: operator.userId,
        operatorName: operator.displayName
      }
    },
    callerId: parentToPhone ?? parentFromPhone ?? "unknown",
    recordingCallbackUrl: recordingCallback,
    timeoutSeconds: Number(process.env.CALLS_TWILIO_OPERATOR_RING_TIMEOUT_SECONDS ?? "25"),
    callSessionId,
    attempt,
    offeredUserIds: [...exhaustedOperators, operator.userId]
  });

  return buildVoiceResponse(twiml);
}
