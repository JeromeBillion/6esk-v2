import { z } from "zod";
import { timingSafeEqual } from "crypto";
import { attachCallTranscript, resolveCallSessionProviderScope } from "@/server/calls/service";
import { normalizeDeepgramTranscriptPayload } from "@/server/calls/stt-deepgram";
import { authorizeCallWebhook, type CallWebhookAuthResult } from "@/server/calls/webhook";
import { recordAuditLog } from "@/server/audit";
import {
  listActiveProviderWebhookSecrets,
  markProviderWebhookSecretUsed,
  ProviderWebhookSecretConfigurationError,
  shouldRequireTenantProviderWebhookSecrets,
  type ActiveProviderWebhookSecret
} from "@/server/provider-webhook-secrets";

const callTranscriptSchema = z.object({
  callSessionId: z.string().uuid().optional().nullable(),
  provider: z.string().optional().nullable(),
  providerCallId: z.string().optional().nullable(),
  transcriptText: z.string().optional().nullable(),
  transcriptUrl: z.string().url().optional().nullable(),
  timestamp: z.union([z.string(), z.number()]).optional().nullable(),
  payload: z.record(z.unknown()).optional().nullable()
});

type TranscriptWebhookAuthResult =
  | CallWebhookAuthResult
  | {
      authorized: boolean;
      mode: "provider_token";
      reason: "ok" | "invalid_provider_token" | "missing_provider_token";
    };

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

function constantTimeEquals(left: string | null | undefined, right: string) {
  const leftValue = left?.trim();
  if (!leftValue) return false;
  const leftBuffer = Buffer.from(leftValue, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  const requestUrl = new URL(request.url);
  const providedSecret = request.headers.get("x-6esk-secret") ?? request.headers.get("x-call-secret");
  const deepgramToken = request.headers.get("dg-token")?.trim() ?? null;
  const callbackToken = requestUrl.searchParams.get("callback_token")?.trim() ?? null;
  const transcriptSharedSecrets = [
    process.env.CALLS_TRANSCRIPT_SHARED_SECRET?.trim(),
    process.env.INBOUND_SHARED_SECRET?.trim()
  ].filter((value): value is string => Boolean(value));

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
  const scope = await resolveCallSessionProviderScope({
    callSessionId: data.callSessionId ?? null,
    provider: data.provider ?? null,
    providerCallId: data.providerCallId ?? null
  });
  const requireTenantSecrets = shouldRequireTenantProviderWebhookSecrets();
  const providerToken = deepgramToken ?? callbackToken;
  const isDeepgramPayload =
    data.provider?.trim().toLowerCase() === "deepgram" ||
    ((data.payload as { source?: unknown } | null)?.source === "deepgram");

  let authorization: TranscriptWebhookAuthResult;

  if (providerToken) {
    if (!scope && requireTenantSecrets) {
      return Response.json(
        { error: "Call session not found", code: "unresolved_call_provider_route" },
        { status: 404 }
      );
    }

    let providerSecrets: ActiveProviderWebhookSecret[] = [];
    try {
      providerSecrets = scope
        ? await listActiveProviderWebhookSecrets({
            scope,
            provider: "deepgram",
            secretType: "callback_token"
          })
        : [];
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

    const globalDeepgramToken = process.env.CALLS_STT_DEEPGRAM_CALLBACK_TOKEN?.trim();
    if (globalDeepgramToken && !requireTenantSecrets) {
      providerSecrets.push({
        id: "env:CALLS_STT_DEEPGRAM_CALLBACK_TOKEN",
        secret: globalDeepgramToken,
        source: "env"
      });
    }
    if (!requireTenantSecrets) {
      transcriptSharedSecrets.forEach((secret, index) => {
        providerSecrets.push({
          id: `env:CALLS_TRANSCRIPT_SHARED_SECRET:${index}`,
          secret,
          source: "env"
        });
      });
    }

    if (!providerSecrets.length && requireTenantSecrets) {
      return Response.json(
        {
          error: "Provider webhook secret is not configured for this tenant.",
          code: "provider_webhook_secret_missing"
        },
        { status: 503 }
      );
    }

    const matchedSecret =
      providerSecrets.find((secret) => constantTimeEquals(providerToken, secret.secret)) ?? null;
    if (matchedSecret && scope) {
      await markProviderWebhookSecretUsed(matchedSecret.id, scope).catch(() => {});
      authorization = { authorized: true, mode: "provider_token", reason: "ok" };
    } else {
      authorization = {
        authorized: false,
        mode: "provider_token",
        reason: "invalid_provider_token"
      };
    }
  } else if (requireTenantSecrets && isDeepgramPayload) {
    authorization = {
      authorized: false,
      mode: "provider_token",
      reason: "missing_provider_token"
    };
  } else if (transcriptSharedSecrets.includes(providedSecret ?? "")) {
    authorization = {
      authorized: true,
      mode: "shared_secret",
      reason: "ok"
    };
  } else {
    authorization = authorizeCallWebhook({
      rawBody,
      providedSignature:
        request.headers.get("x-6esk-signature") ?? request.headers.get("x-call-signature"),
      providedSecret,
      providedTimestamp:
        request.headers.get("x-6esk-timestamp") ?? request.headers.get("x-call-timestamp")
    });
  }

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
