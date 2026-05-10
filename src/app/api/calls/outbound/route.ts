import { z } from "zod";
import { getSessionUser } from "@/server/auth/session";
import { canManageTickets, isLeadAdmin } from "@/server/auth/roles";
import { getTicketById } from "@/server/tickets";
import { recordAuditLog } from "@/server/audit";
import {
  getTicketCallOptions,
  queueOutboundCall,
  resolveCallPhoneForRequest
} from "@/server/calls/service";
import { deliverPendingCallEvents } from "@/server/calls/outbox";
import { getLatestVoiceConsentState } from "@/server/calls/consent";
import {
  evaluateVoiceCallPolicy,
  getHumanVoicePolicyFromEnv
} from "@/server/calls/policy";
import { redactPhoneNumber } from "@/server/calls/redaction";
import { checkModuleEntitlement } from "@/server/tenant/module-guard";
import { recordModuleUsageEvent } from "@/server/module-metering";

const outboundCallSchema = z.object({
  ticketId: z.string().uuid(),
  candidateId: z.string().optional().nullable(),
  toPhone: z.string().optional().nullable(),
  fromPhone: z.string().optional().nullable(),
  reason: z.string().min(1).max(500),
  idempotencyKey: z.string().max(200).optional().nullable(),
  metadata: z.record(z.unknown()).optional().nullable()
});

function requesterEmailForConsent(value: string | null | undefined) {
  if (!value || typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim().toLowerCase();
  if (!trimmed || trimmed.startsWith("voice:") || trimmed.startsWith("whatsapp:")) {
    return null;
  }
  return trimmed;
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!canManageTickets(user)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  const tenantId = user.tenant_id;
  if (!tenantId) {
    return Response.json({ error: "Tenant missing" }, { status: 403 });
  }
  if (!(await checkModuleEntitlement("voice", tenantId))) {
    return Response.json(
      {
        error: "Voice module is not enabled for this workspace.",
        code: "module_disabled",
        module: "voice"
      },
      { status: 409 }
    );
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = outboundCallSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json({ error: "Invalid payload" }, { status: 400 });
  }

  const data = parsed.data;
  const ticket = await getTicketById(data.ticketId, tenantId);
  if (!ticket) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  if (!isLeadAdmin(user) && ticket.assigned_user_id !== user.id) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const options = await getTicketCallOptions(data.ticketId, tenantId);
  if (!options) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const resolved = resolveCallPhoneForRequest({
    options,
    candidateId: data.candidateId ?? null,
    toPhone: data.toPhone ?? null
  });

  if (resolved.status === "selection_required") {
    return Response.json(
      {
        status: "selection_required",
        errorCode: resolved.errorCode,
        detail: resolved.detail,
        defaultCandidateId: resolved.defaultCandidateId,
        candidates: resolved.candidates
      },
      { status: 409 }
    );
  }

  if (resolved.status === "failed") {
    return Response.json(
      {
        status: "failed",
        errorCode: resolved.errorCode,
        detail: resolved.detail
      },
      { status: 400 }
    );
  }

  const maxCallsPerHour = Number(process.env.RATE_LIMIT_CALLS_OUTBOUND ?? "0");
  const consentState = await getLatestVoiceConsentState({
    customerId: ticket.customer_id ?? null,
    phone: resolved.phone,
    email: requesterEmailForConsent(ticket.requester_email)
  });
  const policyCheck = await evaluateVoiceCallPolicy({
    actor: "human",
    policy: getHumanVoicePolicyFromEnv(),
    ticketMetadata: (ticket.metadata as Record<string, unknown> | null) ?? null,
    consentState,
    selectedCandidateId: resolved.selectedCandidateId ?? null,
    actorUserId: user.id,
    defaultMaxCallsPerHour: Number.isFinite(maxCallsPerHour) ? maxCallsPerHour : null
  });
  if (!policyCheck.allowed) {
    return Response.json(
      {
        status: "blocked",
        errorCode: policyCheck.code,
        detail: policyCheck.detail
      },
      { status: 403 }
    );
  }

  try {
    const queued = await queueOutboundCall({
      ticketId: data.ticketId,
      tenantId,
      toPhone: resolved.phone,
      fromPhone: data.fromPhone ?? null,
      reason: data.reason,
      idempotencyKey: data.idempotencyKey ?? null,
      origin: "human",
      actorUserId: user.id,
      metadata: {
        ...(data.metadata ?? {}),
        selectedCandidateId: resolved.selectedCandidateId
      }
    });
    void deliverPendingCallEvents({ limit: 5 }).catch(() => {});

    await recordAuditLog({
      tenantId,
      actorUserId: user.id,
      action: "call_queued",
      entityType: "call_session",
      entityId: queued.callSessionId,
      data: {
        ticketId: data.ticketId,
        toPhone: redactPhoneNumber(queued.toPhone),
        idempotent: queued.idempotent
      }
    });
    await recordModuleUsageEvent({
      tenantId,
      moduleKey: "voice",
      usageKind: "call_queued",
      actorType: "human",
      metadata: {
        route: "/api/calls/outbound",
        ticketId: data.ticketId,
        callSessionId: queued.callSessionId,
        messageId: queued.messageId,
        idempotent: queued.idempotent
      }
    });

    return Response.json({
      status: queued.status,
      callSessionId: queued.callSessionId,
      messageId: queued.messageId,
      toPhone: queued.toPhone,
      idempotent: queued.idempotent
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Failed to queue outbound call";
    return Response.json({ error: "Failed to queue outbound call", detail }, { status: 500 });
  }
}
