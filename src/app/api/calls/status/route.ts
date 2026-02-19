import { z } from "zod";
import { CALL_STATUSES, updateCallSessionStatus } from "@/server/calls/service";
import { authorizeCallWebhook } from "@/server/calls/webhook";
import { recordAuditLog } from "@/server/audit";

const callStatusSchema = z.object({
  callSessionId: z.string().uuid().optional().nullable(),
  provider: z.string().optional().nullable(),
  providerCallId: z.string().optional().nullable(),
  status: z.enum(CALL_STATUSES),
  timestamp: z.union([z.string(), z.number()]).optional().nullable(),
  durationSeconds: z.number().optional().nullable(),
  recordingUrl: z.string().url().optional().nullable(),
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
  const authorization = authorizeCallWebhook({
    rawBody,
    providedSignature:
      request.headers.get("x-6esk-signature") ?? request.headers.get("x-call-signature"),
    providedSecret: request.headers.get("x-6esk-secret"),
    providedTimestamp:
      request.headers.get("x-6esk-timestamp") ?? request.headers.get("x-call-timestamp")
  });

  if (!authorization.authorized) {
    void recordAuditLog({
      action: "call_webhook_rejected",
      entityType: "call_webhook",
      data: {
        endpoint: "/api/calls/status",
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

  const parsed = callStatusSchema.safeParse(payload);
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

  const occurredAt = parseTimestamp(data.timestamp);
  const result = await updateCallSessionStatus({
    callSessionId: data.callSessionId ?? null,
    provider: data.provider ?? null,
    providerCallId: data.providerCallId ?? null,
    status: data.status,
    occurredAt: occurredAt ?? undefined,
    durationSeconds: data.durationSeconds ?? null,
    recordingUrl: data.recordingUrl ?? null,
    payload: (data.payload as Record<string, unknown> | null) ?? null
  });

  if (result.status === "not_found") {
    return Response.json({ error: "Call session not found" }, { status: 404 });
  }

  return Response.json(result);
}
