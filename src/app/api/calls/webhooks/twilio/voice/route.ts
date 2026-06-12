import {
  createOrUpdateInboundCall,
  isInboundCallProviderRoutingError,
  resolveInboundCallProviderScope
} from "@/server/calls/service";
import {
  buildTwilioPublicUrl,
  normalizeTwilioParams,
  validateTwilioWebhookForTenant
} from "@/server/calls/twilio";
import { reserveNextVoiceDeskOperatorForCall } from "@/server/calls/operators";
import {
  buildDeskOperatorDialTwiML,
  buildHoldAndRetryTwiML,
  buildUnavailableTwiML,
  buildVoiceResponse
} from "@/server/calls/twilio-queue";
import { recordAuditLog } from "@/server/audit";
import {
  integrationError,
  validateIntegrationApiVersion
} from "@/server/api-contract";
import { runInBackground } from "@/server/async";
import {
  ProviderWebhookSecretConfigurationError,
  shouldRequireTenantProviderWebhookSecrets
} from "@/server/provider-webhook-secrets";

function readString(value: FormDataEntryValue | null | undefined) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
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

  const providerCallId = readString(formData.get("CallSid"));
  const fromPhone = readString(formData.get("From"));
  const toPhone = readString(formData.get("To"));
  const attempt = Number(new URL(request.url).searchParams.get("attempt") ?? "0");

  if (!providerCallId || !fromPhone) {
    return integrationError(request, {
      status: 400,
      code: "missing_call_fields",
      message: "CallSid and From are required"
    });
  }

  let routedScope: Awaited<ReturnType<typeof resolveInboundCallProviderScope>> = null;
  try {
    routedScope = await resolveInboundCallProviderScope({
      provider: "twilio",
      toPhone,
      metadata: {
        accountSid: params.AccountSid ?? null
      }
    });
  } catch (error) {
    if (isInboundCallProviderRoutingError(error)) {
      runInBackground(recordAuditLog({
        action: "call_webhook_rejected",
        entityType: "call_webhook",
        data: {
          endpoint: "/api/calls/webhooks/twilio/voice",
          mode: "twilio_signature",
          reason: error.code,
          callSid: providerCallId,
          toPhone
        }
      }), "Failed to record rejected Twilio voice webhook audit event");
      return integrationError(request, {
        status: error.status,
        code: error.code,
        message:
          error.code === "unresolved_call_provider_route"
            ? "Unresolved call provider route"
            : "Ambiguous call provider route"
      });
    }
    throw error;
  }

  if (!routedScope && shouldRequireTenantProviderWebhookSecrets()) {
    runInBackground(recordAuditLog({
      action: "call_webhook_rejected",
      entityType: "call_webhook",
      data: {
        endpoint: "/api/calls/webhooks/twilio/voice",
        mode: "twilio_signature",
        reason: "unresolved_call_provider_route",
        callSid: providerCallId,
        toPhone
      }
    }), "Failed to record rejected Twilio voice webhook audit event");
    return integrationError(request, {
      status: 404,
      code: "unresolved_call_provider_route",
      message: "Unresolved call provider route"
    });
  }

  let verification: Awaited<ReturnType<typeof validateTwilioWebhookForTenant>>;
  try {
    verification = await validateTwilioWebhookForTenant({
      scope: routedScope,
      providerAccountId: params.AccountSid ?? null,
      pathname: "/api/calls/webhooks/twilio/voice",
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
    runInBackground(recordAuditLog({
      action: "call_webhook_rejected",
      entityType: "call_webhook",
      data: {
        endpoint: "/api/calls/webhooks/twilio/voice",
        mode: "twilio_signature",
        reason: "invalid_signature"
      }
    }), "Failed to record rejected Twilio voice webhook audit event");
    return integrationError(request, {
      status: 401,
      code: "unauthorized",
      message: "Unauthorized"
    });
  }

  const inbound = await createOrUpdateInboundCall({
    tenantId: routedScope?.tenantId,
    provider: "twilio",
    providerCallId,
    fromPhone,
    toPhone,
    status: "ringing",
    occurredAt: new Date(),
    metadata: {
      source: "twilio_voice_webhook",
      accountSid: params.AccountSid ?? null,
      callSid: providerCallId,
      direction: params.Direction ?? null,
      called: params.Called ?? null,
      callerName: params.CallerName ?? null
    }
  });

  const operator = await reserveNextVoiceDeskOperatorForCall({
    callSessionId: inbound.callSessionId
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
        callSessionId: inbound.callSessionId,
        ticketId: inbound.ticketId,
        direction: "inbound",
        fromPhone,
        toPhone,
        operatorUserId: operator.userId,
        operatorName: operator.displayName
      }
    },
    callerId: toPhone ?? fromPhone,
    recordingCallbackUrl: recordingCallback,
    timeoutSeconds: Number(process.env.CALLS_TWILIO_OPERATOR_RING_TIMEOUT_SECONDS ?? "25"),
    callSessionId: inbound.callSessionId,
    attempt,
    offeredUserIds: [operator.userId]
  });

  return buildVoiceResponse(twiml);
}
