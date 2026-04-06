import { buildTwilioDialTwiML, buildTwilioPublicUrl, type TwilioDialTarget } from "@/server/calls/twilio";

function trim(value: string | null | undefined) {
  const normalized = (value ?? "").trim();
  return normalized || null;
}

function readCsv(value: string | null | undefined) {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function buildVoiceResponse(body: string) {
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "text/xml; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

export function buildUnavailableTwiML() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">All desk operators are currently unavailable. Please try again shortly.</Say>
  <Hangup />
</Response>`;
}

export function buildHoldAndRetryTwiML({
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

export function shouldContinueVoiceQueue(status: string | null | undefined) {
  const normalized = trim(status)?.toLowerCase();
  if (!normalized) {
    return false;
  }
  return ["no-answer", "busy", "failed"].includes(normalized);
}

export function parseQueuedOperatorIds(value: string | null | undefined) {
  return readCsv(value);
}

export function buildVoiceQueueActionUrl({
  requestUrl,
  callSessionId,
  operatorUserId,
  offeredUserIds,
  attempt
}: {
  requestUrl: string;
  callSessionId: string;
  operatorUserId: string;
  offeredUserIds: string[];
  attempt: number;
}) {
  const actionUrl = new URL(buildTwilioPublicUrl("/api/calls/webhooks/twilio/voice/queue", requestUrl));
  actionUrl.searchParams.set("callSessionId", callSessionId);
  actionUrl.searchParams.set("operatorUserId", operatorUserId);
  actionUrl.searchParams.set("attempt", String(attempt));
  if (offeredUserIds.length) {
    actionUrl.searchParams.set("offered", offeredUserIds.join(","));
  }
  return actionUrl.toString();
}

export function buildDeskOperatorDialTwiML({
  requestUrl,
  target,
  callerId,
  recordingCallbackUrl,
  timeoutSeconds,
  callSessionId,
  attempt,
  offeredUserIds
}: {
  requestUrl: string;
  target: Extract<TwilioDialTarget, { type: "client" }>;
  callerId: string;
  recordingCallbackUrl: string;
  timeoutSeconds?: number;
  callSessionId: string;
  attempt: number;
  offeredUserIds: string[];
}) {
  const operatorUserId = trim(target.parameters?.operatorUserId);
  if (!operatorUserId) {
    throw new Error("Desk operator target is missing operatorUserId.");
  }

  return buildTwilioDialTwiML({
    targets: [target],
    callerId,
    recordingCallbackUrl,
    timeoutSeconds,
    actionUrl: buildVoiceQueueActionUrl({
      requestUrl,
      callSessionId,
      operatorUserId,
      offeredUserIds,
      attempt
    })
  });
}
