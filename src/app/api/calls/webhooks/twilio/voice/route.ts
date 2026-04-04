import { createOrUpdateInboundCall } from "@/server/calls/service";
import {
  buildTwilioDialTwiML,
  buildTwilioPublicUrl,
  normalizeTwilioParams,
  validateTwilioWebhook
} from "@/server/calls/twilio";
import { listAvailableVoiceDeskOperators } from "@/server/calls/operators";
import { recordAuditLog } from "@/server/audit";

function readString(value: FormDataEntryValue | null | undefined) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function buildVoiceResponse(body: string) {
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "text/xml; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

function buildHoldAndRetryTwiML({
  requestUrl,
  attempt
}: {
  requestUrl: string;
  attempt: number;
}) {
  const nextAttempt = attempt + 1;
  const redirectUrl = new URL(buildTwilioPublicUrl("/api/calls/webhooks/twilio/voice", requestUrl));
  redirectUrl.searchParams.set("attempt", String(nextAttempt));
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">Please hold while we connect you to the desk.</Say>
  <Pause length="5" />
  <Redirect method="POST">${redirectUrl.toString()}</Redirect>
</Response>`;
}

function buildUnavailableTwiML() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">All desk operators are currently unavailable. Please try again shortly.</Say>
  <Hangup />
</Response>`;
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
  const isValid = validateTwilioWebhook({
    pathname: "/api/calls/webhooks/twilio/voice",
    requestUrl: request.url,
    signature: request.headers.get("x-twilio-signature"),
    params
  });

  if (!isValid) {
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

  const providerCallId = readString(formData.get("CallSid"));
  const fromPhone = readString(formData.get("From"));
  const toPhone = readString(formData.get("To"));
  const attempt = Number(new URL(request.url).searchParams.get("attempt") ?? "0");

  if (!providerCallId || !fromPhone) {
    return Response.json({ error: "CallSid and From are required" }, { status: 400 });
  }

  const inbound = await createOrUpdateInboundCall({
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

  const operators = await listAvailableVoiceDeskOperators(8);
  if (!operators.length) {
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
  const twiml = buildTwilioDialTwiML({
    targets: operators.map((operator) => ({
      type: "client" as const,
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
    })),
    callerId: toPhone ?? fromPhone,
    recordingCallbackUrl: recordingCallback,
    timeoutSeconds: Number(process.env.CALLS_TWILIO_OPERATOR_RING_TIMEOUT_SECONDS ?? "25")
  });

  return buildVoiceResponse(twiml);
}
