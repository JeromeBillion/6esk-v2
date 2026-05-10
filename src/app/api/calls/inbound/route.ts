import { z } from "zod";
import { CALL_STATUSES, createOrUpdateInboundCall } from "@/server/calls/service";
import { authorizeCallWebhook } from "@/server/calls/webhook";
import { recordAuditLog } from "@/server/audit";

const inboundCallSchema = z.object({
  provider: z.string().optional().nullable(),
  providerCallId: z.string().optional().nullable(),
  from: z.string().min(1),
  to: z.string().optional().nullable(),
  status: z.enum(CALL_STATUSES).optional().nullable(),
  timestamp: z.union([z.string(), z.number()]).optional().nullable(),
  durationSeconds: z.number().optional().nullable(),
  ticketId: z.string().uuid().optional().nullable(),
  tenantId: z.string().uuid().optional().nullable(),
  metadata: z.record(z.unknown()).optional().nullable()
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
        endpoint: "/api/calls/inbound",
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

  const parsed = inboundCallSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json({ error: "Invalid payload" }, { status: 400 });
  }

  const data = parsed.data;
  const occurredAt = parseTimestamp(data.timestamp);

  try {
    const result = await createOrUpdateInboundCall({
      provider: data.provider ?? null,
      providerCallId: data.providerCallId ?? null,
      fromPhone: data.from,
      toPhone: data.to ?? null,
      status: data.status ?? null,
      occurredAt: occurredAt ?? undefined,
      durationSeconds: data.durationSeconds ?? null,
      ticketId: data.ticketId ?? null,
      tenantId: data.tenantId ?? null,
      metadata: (data.metadata as Record<string, unknown> | null) ?? null
    });
    return Response.json({ acknowledged: true, ...result });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Failed to process inbound call";
    return Response.json({ error: "Failed to process inbound call", detail }, { status: 500 });
  }
}
