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
  ProviderWebhookSecretConfigurationError,
  shouldRequireTenantProviderWebhookSecrets
} from "@/server/provider-webhook-secrets";

function readString(value: FormDataEntryValue | null | undefined) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

export async function POST(request: Request) {
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
    return Response.json({ error: "CallSid and From are required" }, { status: 400 });
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
      void recordAuditLog({
        action: "call_webhook_rejected",
        entityType: "call_webhook",
        data: {
          endpoint: "/api/calls/webhooks/twilio/voice",
          mode: "twilio_signature",
          reason: error.code,
          callSid: providerCallId,
          toPhone
        }
      }).catch(() => {});
      return Response.json(
        {
          error:
            error.code === "unresolved_call_provider_route"
              ? "Unresolved call provider route"
              : "Ambiguous call provider route",
          code: error.code
        },
        { status: error.status }
      );
    }
    throw error;
  }

  if (!routedScope && shouldRequireTenantProviderWebhookSecrets()) {
    void recordAuditLog({
      action: "call_webhook_rejected",
      entityType: "call_webhook",
      data: {
        endpoint: "/api/calls/webhooks/twilio/voice",
        mode: "twilio_signature",
        reason: "unresolved_call_provider_route",
        callSid: providerCallId,
        toPhone
      }
    }).catch(() => {});
    return Response.json(
      { error: "Unresolved call provider route", code: "unresolved_call_provider_route" },
      { status: 404 }
    );
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
        endpoint: "/api/calls/webhooks/twilio/voice",
        mode: "twilio_signature",
        reason: "invalid_signature"
      }
    }).catch(() => {});
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let inbound: Awaited<ReturnType<typeof createOrUpdateInboundCall>>;
  try {
    inbound = await createOrUpdateInboundCall({
      tenantKey: routedScope?.tenantKey,
      workspaceKey: routedScope?.workspaceKey,
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
  } catch (error) {
    if (isInboundCallProviderRoutingError(error)) {
      void recordAuditLog({
        action: "call_webhook_rejected",
        entityType: "call_webhook",
        data: {
          endpoint: "/api/calls/webhooks/twilio/voice",
          mode: "twilio_signature",
          reason: error.code,
          callSid: providerCallId,
          toPhone
        }
      }).catch(() => {});
      return Response.json(
        {
          error:
            error.code === "unresolved_call_provider_route"
              ? "Unresolved call provider route"
              : "Ambiguous call provider route",
          code: error.code
        },
        { status: error.status }
      );
    }
    throw error;
  }

  const operator = await reserveNextVoiceDeskOperatorForCall({
    tenantKey: routedScope?.tenantKey,
    workspaceKey: routedScope?.workspaceKey,
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
