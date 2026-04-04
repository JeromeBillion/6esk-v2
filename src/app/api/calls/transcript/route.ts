import { z } from "zod";
import { attachCallTranscript } from "@/server/calls/service";
import { normalizeDeepgramTranscriptPayload } from "@/server/calls/stt-deepgram";
import { authorizeCallWebhook } from "@/server/calls/webhook";
import { recordAuditLog } from "@/server/audit";

const callTranscriptSchema = z.object({
  callSessionId: z.string().uuid().optional().nullable(),
  provider: z.string().optional().nullable(),
  providerCallId: z.string().optional().nullable(),
  transcriptText: z.string().optional().nullable(),
  transcriptUrl: z.string().url().optional().nullable(),
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
  const rawBody = await request.text();
  const requestUrl = new URL(request.url);
  const providedSecret = request.headers.get("x-6esk-secret") ?? request.headers.get("x-call-secret");
  const deepgramToken = request.headers.get("dg-token")?.trim() ?? null;
  const callbackToken = requestUrl.searchParams.get("callback_token")?.trim() ?? null;
  const expectedDeepgramToken = process.env.CALLS_STT_DEEPGRAM_CALLBACK_TOKEN?.trim() ?? "";
  const transcriptSharedSecrets = [
    process.env.CALLS_TRANSCRIPT_SHARED_SECRET?.trim(),
    process.env.INBOUND_SHARED_SECRET?.trim()
  ].filter((value): value is string => Boolean(value));
  const authorization =
    expectedDeepgramToken && (deepgramToken || callbackToken)
      ? (deepgramToken ?? callbackToken) === expectedDeepgramToken
        ? {
            authorized: true as const,
            mode: "provider_token" as const,
            reason: "ok" as const
          }
        : {
            authorized: false as const,
            mode: "provider_token" as const,
            reason: "invalid_provider_token" as const
          }
      : transcriptSharedSecrets.includes(providedSecret ?? "")
        ? {
            authorized: true as const,
            mode: "shared_secret" as const,
            reason: "ok" as const
          }
        : authorizeCallWebhook({
            rawBody,
            providedSignature:
              request.headers.get("x-6esk-signature") ?? request.headers.get("x-call-signature"),
            providedSecret,
            providedTimestamp:
              request.headers.get("x-6esk-timestamp") ?? request.headers.get("x-call-timestamp")
          });

  if (!authorization.authorized) {
    void recordAuditLog({
      action: "call_webhook_rejected",
      entityType: "call_webhook",
      data: {
        endpoint: "/api/calls/transcript",
        mode: authorization.mode,
        reason: authorization.reason
      }
    }).catch(() => {});
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  payload = normalizeDeepgramTranscriptPayload(payload) ?? payload;

  const parsed = callTranscriptSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json({ error: "Invalid payload" }, { status: 400 });
  }

  const data = parsed.data;
  if (!data.callSessionId && !data.providerCallId) {
    return Response.json(
      { error: "callSessionId or providerCallId is required" },
      { status: 400 }
    );
  }
  if (!data.transcriptText && !data.transcriptUrl) {
    return Response.json(
      { error: "transcriptText or transcriptUrl is required" },
      { status: 400 }
    );
  }

  const occurredAt = parseTimestamp(data.timestamp);
  const result = await attachCallTranscript({
    callSessionId: data.callSessionId ?? null,
    provider: data.provider ?? null,
    providerCallId: data.providerCallId ?? null,
    transcriptText: data.transcriptText ?? null,
    transcriptUrl: data.transcriptUrl ?? null,
    occurredAt: occurredAt ?? undefined,
    payload: (data.payload as Record<string, unknown> | null) ?? null
  });

  if (result.status === "not_found") {
    return Response.json({ error: "Call session not found" }, { status: 404 });
  }
  if (result.status === "failed") {
    return Response.json({ error: result.detail }, { status: 400 });
  }

  return Response.json(result);
}
