import { randomUUID } from "crypto";
import { db } from "@/server/db";
import { buildAgentEvent } from "@/server/agents/events";
import { deliverPendingAgentEvents, enqueueAgentEvent } from "@/server/agents/outbox";
import { normalizeLinkPhone } from "@/server/integrations/external-user-links";
import {
  getLatestVoiceConsentState,
  normalizeVoiceConsentEmail,
  type VoiceConsentStateSnapshot
} from "@/server/calls/consent";
import { getOrCreateMailbox } from "@/server/email/mailbox";
import { putObject } from "@/server/storage/r2";
import { enqueueCallTranscriptJob, markTranscriptJobCompleted } from "@/server/calls/transcript-jobs";
import { enqueueCallTranscriptAiJob } from "@/server/calls/transcript-ai-jobs";
import { buildTwilioMediaFetchConfig } from "@/server/calls/twilio";
import {
  addTagsToTicket,
  createTicket,
  inferTagsFromText,
  recordTicketEvent,
  reopenTicketIfNeeded
} from "@/server/tickets";
import { attachCustomerToTicket, resolveOrCreateCustomerForInbound } from "@/server/customers";

type CallCandidateSource =
  | "customer_primary"
  | "customer_identity"
  | "ticket_metadata"
  | "ticket_requester";

export type TicketCallCandidate = {
  candidateId: string;
  phone: string;
  label: string;
  source: CallCandidateSource;
  isPrimary: boolean;
};

export type TicketCallOptions = {
  ticketId: string;
  selectionRequired: boolean;
  defaultCandidateId: string | null;
  canManualDial: boolean;
  candidates: TicketCallCandidate[];
  consent: VoiceConsentStateSnapshot;
};

type TicketCallContext = {
  id: string;
  mailbox_id: string | null;
  customer_id: string | null;
  requester_email: string;
  metadata: Record<string, unknown> | null;
  primary_phone: string | null;
};

export type ResolveCallPhoneResult =
  | {
      status: "resolved";
      phone: string;
      selectedCandidateId: string | null;
    }
  | {
      status: "selection_required";
      errorCode: "selection_required";
      detail: string;
      candidates: TicketCallCandidate[];
      defaultCandidateId: string | null;
    }
  | {
      status: "failed";
      errorCode: "invalid_candidate" | "missing_phone";
      detail: string;
    };

export type QueueOutboundCallArgs = {
  ticketId: string;
  toPhone: string;
  reason: string;
  fromPhone?: string | null;
  idempotencyKey?: string | null;
  origin?: "human" | "ai";
  actorUserId?: string | null;
  actorIntegrationId?: string | null;
  metadata?: Record<string, unknown> | null;
};

export type QueueOutboundCallResult = {
  status: "queued";
  callSessionId: string;
  messageId: string;
  toPhone: string;
  idempotent: boolean;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function readString(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

export function normalizeCallPhone(value: string | null | undefined) {
  if (!value) return null;
  const normalized = normalizeLinkPhone(value);
  if (!normalized) return null;
  const digits = normalized.replace(/[^\d]/g, "");
  if (digits.length < 7 || digits.length > 15) {
    return null;
  }
  return normalized;
}

function extractRequesterPhone(value: string | null | undefined) {
  const requester = readString(value);
  if (!requester) return null;
  if (requester.startsWith("whatsapp:") || requester.startsWith("voice:")) {
    return normalizeCallPhone(requester.split(":").slice(1).join(":"));
  }
  return normalizeCallPhone(requester);
}

function extractRequesterEmail(value: string | null | undefined) {
  const requester = readString(value);
  if (!requester) return null;
  if (requester.startsWith("whatsapp:") || requester.startsWith("voice:")) {
    return null;
  }
  return normalizeVoiceConsentEmail(requester);
}

function extractMetadataPhones(metadata: Record<string, unknown> | null) {
  const values = new Set<string>();
  if (!metadata) return values;

  const directKeys = ["phone", "phoneNumber", "appUserPhone", "primaryPhone"];
  for (const key of directKeys) {
    const raw = readString(metadata[key]);
    const normalized = normalizeCallPhone(raw);
    if (normalized) {
      values.add(normalized);
    }
  }

  const externalProfile = asRecord(metadata.external_profile);
  if (externalProfile) {
    const profileKeys = ["phone", "phoneNumber", "mobile", "primaryPhone"];
    for (const key of profileKeys) {
      const raw = readString(externalProfile[key]);
      const normalized = normalizeCallPhone(raw);
      if (normalized) {
        values.add(normalized);
      }
    }
  }

  return values;
}

export async function getTicketCallContext(ticketId: string) {
  const result = await db.query<TicketCallContext>(
    `SELECT
       t.id,
       t.mailbox_id,
       t.customer_id,
       t.requester_email,
       t.metadata,
       c.primary_phone
     FROM tickets t
     LEFT JOIN customers c ON c.id = t.customer_id
     WHERE t.id = $1
     LIMIT 1`,
    [ticketId]
  );
  return result.rows[0] ?? null;
}

export async function getTicketCallOptions(ticketId: string): Promise<TicketCallOptions | null> {
  const ticket = await getTicketCallContext(ticketId);
  if (!ticket) {
    return null;
  }

  const byPhone = new Map<string, TicketCallCandidate>();

  const pushCandidate = ({
    candidateId,
    phone,
    label,
    source,
    isPrimary
  }: TicketCallCandidate) => {
    const normalized = normalizeCallPhone(phone);
    if (!normalized) return;

    const existing = byPhone.get(normalized);
    if (!existing) {
      byPhone.set(normalized, {
        candidateId,
        phone: normalized,
        label,
        source,
        isPrimary
      });
      return;
    }

    if (isPrimary && !existing.isPrimary) {
      existing.isPrimary = true;
    }
  };

  if (ticket.primary_phone) {
    pushCandidate({
      candidateId: "customer-primary",
      phone: ticket.primary_phone,
      label: "Primary phone",
      source: "customer_primary",
      isPrimary: true
    });
  }

  if (ticket.customer_id) {
    const identities = await db.query<{
      id: string;
      identity_value: string;
      is_primary: boolean;
    }>(
      `SELECT id, identity_value, is_primary
       FROM customer_identities
       WHERE customer_id = $1
         AND identity_type = 'phone'
       ORDER BY is_primary DESC, updated_at ASC`,
      [ticket.customer_id]
    );
    for (const identity of identities.rows) {
      pushCandidate({
        candidateId: `identity:${identity.id}`,
        phone: identity.identity_value,
        label: identity.is_primary ? "Customer phone (primary identity)" : "Customer phone",
        source: "customer_identity",
        isPrimary: identity.is_primary
      });
    }
  }

  const metadataPhones = Array.from(extractMetadataPhones(asRecord(ticket.metadata)));
  for (const [index, phone] of metadataPhones.entries()) {
    pushCandidate({
      candidateId: `metadata:${index + 1}`,
      phone,
      label: "Profile phone",
      source: "ticket_metadata",
      isPrimary: false
    });
  }

  const requesterPhone = extractRequesterPhone(ticket.requester_email);
  if (requesterPhone) {
    pushCandidate({
      candidateId: "requester",
      phone: requesterPhone,
      label: "Ticket requester phone",
      source: "ticket_requester",
      isPrimary: false
    });
  }

  const candidates = Array.from(byPhone.values());
  const selectionRequired = candidates.length > 1;
  const defaultCandidateId =
    candidates.length === 1
      ? candidates[0].candidateId
      : candidates.find((candidate) => candidate.isPrimary)?.candidateId ?? null;
  const defaultCandidatePhone =
    candidates.find((candidate) => candidate.candidateId === defaultCandidateId)?.phone ??
    candidates[0]?.phone ??
    null;
  const requesterEmail = extractRequesterEmail(ticket.requester_email);
  const consent = await getLatestVoiceConsentState({
    customerId: ticket.customer_id,
    phone: defaultCandidatePhone,
    email: requesterEmail
  });

  return {
    ticketId,
    selectionRequired,
    defaultCandidateId,
    canManualDial: true,
    candidates,
    consent
  };
}

export function resolveCallPhoneForRequest({
  options,
  candidateId,
  toPhone
}: {
  options: TicketCallOptions;
  candidateId?: string | null;
  toPhone?: string | null;
}): ResolveCallPhoneResult {
  const normalizedManual = normalizeCallPhone(toPhone);
  if (normalizedManual) {
    return {
      status: "resolved",
      phone: normalizedManual,
      selectedCandidateId: candidateId ?? null
    };
  }

  if (candidateId) {
    const candidate = options.candidates.find((item) => item.candidateId === candidateId);
    if (!candidate) {
      return {
        status: "failed",
        errorCode: "invalid_candidate",
        detail: "Selected phone candidate was not found."
      };
    }
    return {
      status: "resolved",
      phone: candidate.phone,
      selectedCandidateId: candidate.candidateId
    };
  }

  if (options.selectionRequired) {
    return {
      status: "selection_required",
      errorCode: "selection_required",
      detail: "Multiple phone numbers are available. Select one phone number before calling.",
      candidates: options.candidates,
      defaultCandidateId: options.defaultCandidateId
    };
  }

  if (options.candidates.length === 1) {
    return {
      status: "resolved",
      phone: options.candidates[0].phone,
      selectedCandidateId: options.candidates[0].candidateId
    };
  }

  return {
    status: "failed",
    errorCode: "missing_phone",
    detail: "No phone number available. Provide a phone number to place a call."
  };
}

export async function queueOutboundCall({
  ticketId,
  toPhone,
  reason,
  fromPhone,
  idempotencyKey,
  origin = "human",
  actorUserId,
  actorIntegrationId,
  metadata
}: QueueOutboundCallArgs): Promise<QueueOutboundCallResult> {
  const ticket = await getTicketCallContext(ticketId);
  if (!ticket) {
    throw new Error("Ticket not found.");
  }
  if (!ticket.mailbox_id) {
    throw new Error("Ticket mailbox is missing.");
  }

  const normalizedTo = normalizeCallPhone(toPhone);
  if (!normalizedTo) {
    throw new Error("Invalid destination phone number.");
  }

  const normalizedFrom = normalizeCallPhone(fromPhone);
  const normalizedReason =
    reason.replace(/\s+/g, " ").trim().slice(0, 500) || "Voice call follow-up";
  const normalizedIdempotencyKey = readString(idempotencyKey) ?? null;

  if (normalizedIdempotencyKey) {
    const existing = await db.query<{
      id: string;
      message_id: string | null;
      to_phone: string;
    }>(
      `SELECT id, message_id, to_phone
       FROM call_sessions
       WHERE ticket_id = $1
         AND direction = 'outbound'
         AND idempotency_key = $2
       ORDER BY created_at DESC
       LIMIT 1`,
      [ticketId, normalizedIdempotencyKey]
    );
    const row = existing.rows[0];
    if (row?.message_id) {
      return {
        status: "queued",
        callSessionId: row.id,
        messageId: row.message_id,
        toPhone: row.to_phone,
        idempotent: true
      };
    }
  }

  const callSessionId = randomUUID();
  const messageId = randomUUID();
  const queuedAt = new Date();
  let queuedEventMeta: { sequence: number; eventIdempotencyKey: string } | null = null;
  const previewText = normalizedReason.slice(0, 200);
  const messageFrom =
    normalizedFrom ?? (origin === "ai" ? "voice:ai" : actorUserId ? `voice:${actorUserId}` : "voice:agent");
  const aiMeta =
    origin === "ai"
      ? {
          integrationId: actorIntegrationId ?? null
        }
      : null;
  const messageMetadata = {
    channel: "voice",
    callSessionId,
    reason: normalizedReason,
    idempotencyKey: normalizedIdempotencyKey,
    ...(metadata ?? {})
  };

  const client = await db.connect();
  try {
    await client.query("BEGIN");

    await client.query(
      `INSERT INTO messages (
        id, mailbox_id, ticket_id, direction, channel, message_id, thread_id,
        from_email, to_emails, subject, preview_text, sent_at, is_read, origin, ai_meta, metadata
      ) VALUES (
        $1, $2, $3, 'outbound', 'voice', $4, $5,
        $6, $7, $8, $9, $10, true, $11, $12, $13
      )`,
      [
        messageId,
        ticket.mailbox_id,
        ticketId,
        `voice:${callSessionId}`,
        callSessionId,
        messageFrom,
        [normalizedTo],
        "Voice call",
        previewText || null,
        queuedAt,
        origin,
        aiMeta,
        messageMetadata
      ]
    );

    await client.query(
      `INSERT INTO call_sessions (
        id, provider, ticket_id, mailbox_id, message_id, direction, status,
        from_phone, to_phone, queued_at, idempotency_key, created_by,
        created_by_user_id, created_by_integration_id, metadata
      ) VALUES (
        $1, $2, $3, $4, $5, 'outbound', 'queued',
        $6, $7, $8, $9, $10,
        $11, $12, $13
      )`,
      [
        callSessionId,
        "pending",
        ticketId,
        ticket.mailbox_id,
        messageId,
        normalizedFrom,
        normalizedTo,
        queuedAt,
        normalizedIdempotencyKey,
        origin,
        actorUserId ?? null,
        actorIntegrationId ?? null,
        {
          reason: normalizedReason,
          ...(metadata ?? {})
        }
      ]
    );

    queuedEventMeta = await appendCallEvent({
      queryExecutor: client,
      callSessionId,
      eventType: "queued",
      occurredAt: queuedAt,
      payload: {
        source: origin,
        reason: normalizedReason,
        toPhone: normalizedTo,
        fromPhone: normalizedFrom ?? null
      }
    });

    await client.query(
      `INSERT INTO call_outbox_events (direction, payload, status)
       VALUES ('outbound', $1, 'queued')`,
      [
        {
          callSessionId,
          ticketId,
          messageId,
          toPhone: normalizedTo,
          fromPhone: normalizedFrom ?? null,
          reason: normalizedReason,
          actorUserId: actorUserId ?? null,
          actorIntegrationId: actorIntegrationId ?? null
        }
      ]
    );

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    const duplicateError = error as { code?: string };
    if (normalizedIdempotencyKey && duplicateError.code === "23505") {
      const existing = await db.query<{
        id: string;
        message_id: string | null;
        to_phone: string;
      }>(
        `SELECT id, message_id, to_phone
         FROM call_sessions
         WHERE ticket_id = $1
           AND direction = 'outbound'
           AND idempotency_key = $2
         ORDER BY created_at DESC
         LIMIT 1`,
        [ticketId, normalizedIdempotencyKey]
      );
      const row = existing.rows[0];
      if (row?.message_id) {
        return {
          status: "queued",
          callSessionId: row.id,
          messageId: row.message_id,
          toPhone: row.to_phone,
          idempotent: true
        };
      }
    }
    throw error;
  } finally {
    client.release();
  }

  await recordTicketEvent({
    ticketId,
    eventType: origin === "ai" ? "ai_call_queued" : "call_queued",
    actorUserId: actorUserId ?? null,
    data: {
      callSessionId,
      toPhone: normalizedTo
    }
  });

  const callEvent = buildAgentEvent({
    eventType: "ticket.call.queued",
    ticketId,
    messageId,
    mailboxId: ticket.mailbox_id,
    excerpt: previewText,
    threadId: callSessionId
  });
  await enqueueAgentEvent({
    eventType: "ticket.call.queued",
    payload: {
      ...callEvent,
      call: {
        id: callSessionId,
        status: "queued",
        toPhone: normalizedTo,
        sequence: queuedEventMeta?.sequence ?? 1,
        eventType: "queued",
        eventIdempotencyKey:
          queuedEventMeta?.eventIdempotencyKey ?? buildCallEventIdempotencyKey(callSessionId, 1)
      }
    }
  });
  void deliverPendingAgentEvents().catch(() => {});

  return {
    status: "queued",
    callSessionId,
    messageId,
    toPhone: normalizedTo,
    idempotent: false
  };
}

export const CALL_STATUSES = [
  "queued",
  "dialing",
  "ringing",
  "in_progress",
  "completed",
  "no_answer",
  "busy",
  "failed",
  "canceled"
] as const;

export type CallStatus = (typeof CALL_STATUSES)[number];

type CallSessionRow = {
  id: string;
  ticket_id: string;
  mailbox_id: string | null;
  message_id: string | null;
  provider: string;
  provider_call_id: string | null;
  status: CallStatus;
  event_sequence: number;
  to_phone: string;
  from_phone: string | null;
  recording_url: string | null;
  recording_r2_key: string | null;
  transcript_r2_key: string | null;
  metadata: Record<string, unknown> | null;
};

type UpdateCallSessionStatusArgs = {
  callSessionId?: string | null;
  provider?: string | null;
  providerCallId?: string | null;
  status: CallStatus;
  occurredAt?: Date;
  durationSeconds?: number | null;
  recordingUrl?: string | null;
  payload?: Record<string, unknown> | null;
};

type UpdateCallSessionStatusResult =
  | {
      status: "updated";
      callSessionId: string;
      previousStatus: CallStatus;
      currentStatus: CallStatus;
      ticketId: string;
      mailboxId: string | null;
      messageId: string | null;
    }
  | {
      status: "ignored";
      reason: string;
      callSessionId: string;
      currentStatus: CallStatus;
      ticketId: string;
      mailboxId: string | null;
      messageId: string | null;
    }
  | {
      status: "not_found";
    };

const TERMINAL_CALL_STATUSES: Set<CallStatus> = new Set([
  "completed",
  "no_answer",
  "busy",
  "failed",
  "canceled"
]);

function isTerminalCallStatus(status: CallStatus) {
  return TERMINAL_CALL_STATUSES.has(status);
}

function canTransitionCallStatus(from: CallStatus, to: CallStatus) {
  if (from === to) return true;
  if (isTerminalCallStatus(from)) return false;
  if (to === "queued") return false;
  if (to === "dialing") {
    return from === "queued";
  }
  if (to === "ringing") {
    return from === "queued" || from === "dialing";
  }
  if (to === "in_progress") {
    return from === "queued" || from === "dialing" || from === "ringing";
  }
  if (isTerminalCallStatus(to)) {
    return true;
  }
  return false;
}

function parseStatus(value: string | null | undefined): CallStatus | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if ((CALL_STATUSES as readonly string[]).includes(normalized)) {
    return normalized as CallStatus;
  }
  return null;
}

function toPhoneFromRequester(value: string | null | undefined) {
  const requester = readString(value);
  if (!requester) return null;
  if (requester.startsWith("voice:")) {
    return normalizeCallPhone(requester.replace(/^voice:/, ""));
  }
  if (requester.startsWith("whatsapp:")) {
    return normalizeCallPhone(requester.replace(/^whatsapp:/, ""));
  }
  return normalizeCallPhone(requester);
}

function getSupportAddress() {
  const explicit = process.env.SUPPORT_ADDRESS;
  if (explicit) {
    return explicit.toLowerCase();
  }
  const domain = process.env.RESEND_FROM_DOMAIN ?? "";
  return domain ? `support@${domain}`.toLowerCase() : "";
}

type CallEventQueryExecutor = Pick<typeof db, "query">;

function buildCallEventIdempotencyKey(callSessionId: string, sequence: number) {
  return `${callSessionId}:${sequence}`;
}

async function reserveCallEventSequence(
  queryExecutor: CallEventQueryExecutor,
  callSessionId: string
) {
  const result = await queryExecutor.query<{ event_sequence: number | string | null }>(
    `UPDATE call_sessions
     SET event_sequence = event_sequence + 1,
         updated_at = now()
     WHERE id = $1
     RETURNING event_sequence`,
    [callSessionId]
  );
  const sequence = Number(result.rows[0]?.event_sequence ?? 0);
  if (!Number.isFinite(sequence) || sequence < 1) {
    throw new Error("Failed to allocate call event sequence.");
  }
  return sequence;
}

async function appendCallEvent({
  queryExecutor,
  callSessionId,
  eventType,
  occurredAt,
  payload
}: {
  queryExecutor: CallEventQueryExecutor;
  callSessionId: string;
  eventType: string;
  occurredAt: Date;
  payload?: Record<string, unknown> | null;
}) {
  const sequence = await reserveCallEventSequence(queryExecutor, callSessionId);
  const eventIdempotencyKey = buildCallEventIdempotencyKey(callSessionId, sequence);
  await queryExecutor.query(
    `INSERT INTO call_events (call_session_id, event_type, occurred_at, payload)
     VALUES ($1, $2, $3, $4)`,
    [
      callSessionId,
      eventType,
      occurredAt,
      {
        ...(payload ?? {}),
        sequence,
        eventIdempotencyKey
      }
    ]
  );
  return { sequence, eventIdempotencyKey };
}

async function getCallSessionByProvider(provider: string, providerCallId: string) {
  const result = await db.query<CallSessionRow>(
    `SELECT id, ticket_id, mailbox_id, message_id, provider, provider_call_id, status, event_sequence, to_phone, from_phone,
            recording_url, recording_r2_key, transcript_r2_key, metadata
     FROM call_sessions
     WHERE provider = $1
       AND provider_call_id = $2
     ORDER BY created_at DESC
     LIMIT 1`,
    [provider, providerCallId]
  );
  return result.rows[0] ?? null;
}

async function getCallSessionById(callSessionId: string) {
  const result = await db.query<CallSessionRow>(
    `SELECT id, ticket_id, mailbox_id, message_id, provider, provider_call_id, status, event_sequence, to_phone, from_phone,
            recording_url, recording_r2_key, transcript_r2_key, metadata
     FROM call_sessions
     WHERE id = $1
     LIMIT 1`,
    [callSessionId]
  );
  return result.rows[0] ?? null;
}

export async function updateCallSessionStatus({
  callSessionId,
  provider,
  providerCallId,
  status,
  occurredAt,
  durationSeconds,
  recordingUrl,
  payload
}: UpdateCallSessionStatusArgs): Promise<UpdateCallSessionStatusResult> {
  const statusValue = parseStatus(status);
  if (!statusValue) {
    return { status: "not_found" };
  }

  const providerValue = readString(provider) ?? "pending";
  const providerCallIdValue = readString(providerCallId);

  const session =
    (callSessionId ? await getCallSessionById(callSessionId) : null) ??
    (providerCallIdValue ? await getCallSessionByProvider(providerValue, providerCallIdValue) : null);

  if (!session) {
    return { status: "not_found" };
  }

  const previousStatus = session.status;
  if (!canTransitionCallStatus(previousStatus, statusValue)) {
    return {
      status: "ignored",
      reason: `Invalid transition ${previousStatus} -> ${statusValue}`,
      callSessionId: session.id,
      currentStatus: previousStatus,
      ticketId: session.ticket_id,
      mailboxId: session.mailbox_id,
      messageId: session.message_id
    };
  }

  const at = occurredAt ?? new Date();
  const isNoop = previousStatus === statusValue;
  const startedAt = statusValue === "in_progress" ? at : null;
  const endedAt = isTerminalCallStatus(statusValue) ? at : null;
  const nextDuration =
    typeof durationSeconds === "number" && Number.isFinite(durationSeconds) && durationSeconds >= 0
      ? Math.floor(durationSeconds)
      : null;
  const recordingUrlValue = readString(recordingUrl);

  await db.query(
    `UPDATE call_sessions
     SET status = $2,
         provider = COALESCE($3, provider),
         provider_call_id = COALESCE($4, provider_call_id),
         started_at = CASE
           WHEN $5::timestamptz IS NOT NULL THEN COALESCE(started_at, $5::timestamptz)
           ELSE started_at
         END,
         ended_at = CASE
           WHEN $6::timestamptz IS NOT NULL THEN $6::timestamptz
           ELSE ended_at
         END,
         duration_seconds = CASE
           WHEN $7::int IS NOT NULL THEN $7::int
           ELSE duration_seconds
         END,
         recording_url = COALESCE($8, recording_url),
         updated_at = now()
     WHERE id = $1`,
    [
      session.id,
      statusValue,
      providerValue,
      providerCallIdValue,
      startedAt,
      endedAt,
      nextDuration,
      recordingUrlValue
    ]
  );

  const statusEventMeta = await appendCallEvent({
    queryExecutor: db,
    callSessionId: session.id,
    eventType: statusValue,
    occurredAt: at,
    payload: {
      ...(payload ?? {}),
      provider: providerValue,
      providerCallId: providerCallIdValue
    }
  });

  if (!isNoop) {
    if (statusValue === "in_progress") {
      await recordTicketEvent({
        ticketId: session.ticket_id,
        eventType: "call_started",
        data: {
          callSessionId: session.id,
          provider: providerValue,
          providerCallId: providerCallIdValue
        }
      });
      const startedEvent = buildAgentEvent({
        eventType: "ticket.call.started",
        ticketId: session.ticket_id,
        messageId: session.message_id,
        mailboxId: session.mailbox_id,
        excerpt: `Call started to ${session.to_phone}`,
        threadId: session.id
      });
      await enqueueAgentEvent({
        eventType: "ticket.call.started",
        payload: {
          ...startedEvent,
          call: {
            id: session.id,
            status: statusValue,
            toPhone: session.to_phone,
            fromPhone: session.from_phone,
            sequence: statusEventMeta.sequence,
            eventType: statusValue,
            eventIdempotencyKey: statusEventMeta.eventIdempotencyKey
          }
        }
      });
      void deliverPendingAgentEvents().catch(() => {});
    }

    if (isTerminalCallStatus(statusValue)) {
      await recordTicketEvent({
        ticketId: session.ticket_id,
        eventType: statusValue === "failed" ? "call_failed" : "call_ended",
        data: {
          callSessionId: session.id,
          status: statusValue,
          durationSeconds: nextDuration
        }
      });
      const terminalEvent = buildAgentEvent({
        eventType: statusValue === "failed" ? "ticket.call.failed" : "ticket.call.ended",
        ticketId: session.ticket_id,
        messageId: session.message_id,
        mailboxId: session.mailbox_id,
        excerpt: `Call ${statusValue.replace(/_/g, " ")}`,
        threadId: session.id
      });
      await enqueueAgentEvent({
        eventType: statusValue === "failed" ? "ticket.call.failed" : "ticket.call.ended",
        payload: {
          ...terminalEvent,
          call: {
            id: session.id,
            status: statusValue,
            toPhone: session.to_phone,
            fromPhone: session.from_phone,
            durationSeconds: nextDuration,
            sequence: statusEventMeta.sequence,
            eventType: statusValue,
            eventIdempotencyKey: statusEventMeta.eventIdempotencyKey
          }
        }
      });
      void deliverPendingAgentEvents().catch(() => {});
    }
  }

  return {
    status: isNoop ? "ignored" : "updated",
    reason: isNoop ? "No status change" : undefined,
    callSessionId: session.id,
    previousStatus,
    currentStatus: statusValue,
    ticketId: session.ticket_id,
    mailboxId: session.mailbox_id,
    messageId: session.message_id
  } as UpdateCallSessionStatusResult;
}

export async function attachCallRecording({
  callSessionId,
  provider,
  providerCallId,
  recordingUrl,
  durationSeconds,
  occurredAt,
  payload
}: {
  callSessionId?: string | null;
  provider?: string | null;
  providerCallId?: string | null;
  recordingUrl: string;
  durationSeconds?: number | null;
  occurredAt?: Date;
  payload?: Record<string, unknown> | null;
}) {
  const providerValue = readString(provider) ?? "pending";
  const providerCallIdValue = readString(providerCallId);
  const session =
    (callSessionId ? await getCallSessionById(callSessionId) : null) ??
    (providerCallIdValue ? await getCallSessionByProvider(providerValue, providerCallIdValue) : null);
  if (!session) {
    return { status: "not_found" as const };
  }
  const url = readString(recordingUrl);
  if (!url) {
    return { status: "failed" as const, detail: "Recording URL is required." };
  }

  if (session.recording_r2_key) {
    return {
      status: "ignored" as const,
      callSessionId: session.id,
      recordingUrl: session.recording_url,
      recordingR2Key: session.recording_r2_key
    };
  }

  const at = occurredAt ?? new Date();
  let uploadedKey: string | null = null;
  let attachmentId: string | null = null;
  let canonicalRecordingUrl = url;

  if (!session.recording_r2_key && session.message_id) {
    try {
      const twilioMediaConfig = providerValue === "twilio" ? buildTwilioMediaFetchConfig(url) : null;
      const response = twilioMediaConfig
        ? await fetch(twilioMediaConfig.url, { headers: twilioMediaConfig.headers })
        : await fetch(url);
      if (response.ok) {
        const contentType = response.headers.get("content-type") || "audio/mpeg";
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const ext = contentType.includes("wav")
          ? "wav"
          : contentType.includes("ogg")
            ? "ogg"
            : contentType.includes("mp4")
              ? "m4a"
              : "mp3";
        uploadedKey = await putObject({
          key: `messages/${session.message_id}/recording.${ext}`,
          body: buffer,
          contentType
        });
        attachmentId = randomUUID();
        await db.query(
          `INSERT INTO attachments (id, message_id, filename, content_type, size_bytes, r2_key)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [attachmentId, session.message_id, `Call Recording.${ext}`, contentType, buffer.length, uploadedKey]
        );
        canonicalRecordingUrl = `/api/attachments/${attachmentId}?disposition=inline`;
      }
    } catch {
      uploadedKey = null;
      attachmentId = null;
      canonicalRecordingUrl = url;
    }
  }

  const parsedDuration =
    typeof durationSeconds === "number" && Number.isFinite(durationSeconds) && durationSeconds >= 0
      ? Math.floor(durationSeconds)
      : null;

  await db.query(
    `UPDATE call_sessions
     SET recording_url = $2,
         recording_r2_key = COALESCE($3, recording_r2_key),
         duration_seconds = COALESCE($4, duration_seconds),
         updated_at = now()
     WHERE id = $1`,
    [session.id, canonicalRecordingUrl, uploadedKey, parsedDuration]
  );

  const recordingEventMeta = await appendCallEvent({
    queryExecutor: db,
    callSessionId: session.id,
    eventType: "recording_ready",
    occurredAt: at,
    payload: {
      recordingUrl: canonicalRecordingUrl,
      recordingR2Key: uploadedKey,
      attachmentId,
      providerRecordingUrl: url,
      ...(payload ?? {})
    }
  });

  await recordTicketEvent({
    ticketId: session.ticket_id,
    eventType: "call_recording_ready",
    data: {
      callSessionId: session.id,
      recordingUrl: canonicalRecordingUrl,
      recordingR2Key: uploadedKey
    }
  });

  const recordingEvent = buildAgentEvent({
    eventType: "ticket.call.recording.ready",
    ticketId: session.ticket_id,
    messageId: session.message_id,
    mailboxId: session.mailbox_id,
    excerpt: "Call recording ready",
    threadId: session.id
  });
  await enqueueAgentEvent({
    eventType: "ticket.call.recording.ready",
    payload: {
      ...recordingEvent,
      call: {
        id: session.id,
        recordingUrl: canonicalRecordingUrl,
        recordingR2Key: uploadedKey,
        providerRecordingUrl: url,
        sequence: recordingEventMeta.sequence,
        eventType: "recording_ready",
        eventIdempotencyKey: recordingEventMeta.eventIdempotencyKey
      }
    }
  });
  void deliverPendingAgentEvents().catch(() => {});

  if (uploadedKey && !session.transcript_r2_key) {
    await enqueueCallTranscriptJob({
      callSessionId: session.id,
      recordingR2Key: uploadedKey,
      metadata: {
        source: "recording_ready",
        ticketId: session.ticket_id,
        messageId: session.message_id,
        provider: providerValue,
        providerCallId: providerCallIdValue,
        providerRecordingUrl: url
      }
    });
  }

  return {
    status: "attached" as const,
    callSessionId: session.id,
    recordingUrl: canonicalRecordingUrl,
    recordingR2Key: uploadedKey,
    attachmentId
  };
}

export async function attachCallTranscript({
  callSessionId,
  provider,
  providerCallId,
  transcriptText,
  transcriptUrl,
  occurredAt,
  payload
}: {
  callSessionId?: string | null;
  provider?: string | null;
  providerCallId?: string | null;
  transcriptText?: string | null;
  transcriptUrl?: string | null;
  occurredAt?: Date;
  payload?: Record<string, unknown> | null;
}) {
  const providerValue = readString(provider) ?? "pending";
  const providerCallIdValue = readString(providerCallId);
  const session =
    (callSessionId ? await getCallSessionById(callSessionId) : null) ??
    (providerCallIdValue ? await getCallSessionByProvider(providerValue, providerCallIdValue) : null);
  if (!session) {
    return { status: "not_found" as const };
  }

  let transcript = readString(transcriptText);
  const transcriptUrlValue = readString(transcriptUrl);
  if (!transcript && transcriptUrlValue) {
    try {
      const response = await fetch(transcriptUrlValue);
      if (response.ok) {
        const text = await response.text();
        transcript = readString(text);
      }
    } catch {
      transcript = null;
    }
  }

  if (!transcript) {
    return { status: "failed" as const, detail: "Transcript text is required." };
  }

  const at = occurredAt ?? new Date();
  let uploadedKey: string | null = null;
  let attachmentId: string | null = null;

  if (!session.transcript_r2_key && session.message_id) {
    try {
      const buffer = Buffer.from(transcript, "utf8");
      uploadedKey = await putObject({
        key: `messages/${session.message_id}/transcript.txt`,
        body: buffer,
        contentType: "text/plain; charset=utf-8"
      });

      const existingAttachment = await db.query<{ id: string }>(
        `SELECT id
         FROM attachments
         WHERE message_id = $1
           AND filename = 'Call Transcript.txt'
         LIMIT 1`,
        [session.message_id]
      );
      attachmentId = existingAttachment.rows[0]?.id ?? randomUUID();

      if (existingAttachment.rows[0]?.id) {
        await db.query(
          `UPDATE attachments
           SET content_type = $2,
               size_bytes = $3,
               r2_key = $4
           WHERE id = $1`,
          [attachmentId, "text/plain; charset=utf-8", buffer.length, uploadedKey]
        );
      } else {
        await db.query(
          `INSERT INTO attachments (id, message_id, filename, content_type, size_bytes, r2_key)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            attachmentId,
            session.message_id,
            "Call Transcript.txt",
            "text/plain; charset=utf-8",
            buffer.length,
            uploadedKey
          ]
        );
      }
    } catch {
      uploadedKey = null;
      attachmentId = null;
    }
  }

  await db.query(
    `UPDATE call_sessions
     SET transcript_r2_key = COALESCE($2, transcript_r2_key),
         updated_at = now()
     WHERE id = $1`,
    [session.id, uploadedKey]
  );

  await markTranscriptJobCompleted({
    callSessionId: session.id,
    transcriptR2Key: uploadedKey
  });

  const transcriptEventMeta = await appendCallEvent({
    queryExecutor: db,
    callSessionId: session.id,
    eventType: "transcript_ready",
    occurredAt: at,
    payload: {
      transcriptR2Key: uploadedKey,
      transcriptUrl: transcriptUrlValue,
      attachmentId,
      ...(payload ?? {})
    }
  });

  await recordTicketEvent({
    ticketId: session.ticket_id,
    eventType: "call_transcript_ready",
    data: {
      callSessionId: session.id,
      transcriptR2Key: uploadedKey,
      transcriptUrl: transcriptUrlValue
    }
  });

  const transcriptEvent = buildAgentEvent({
    eventType: "ticket.call.transcript.ready",
    ticketId: session.ticket_id,
    messageId: session.message_id,
    mailboxId: session.mailbox_id,
    excerpt: "Call transcript ready",
    threadId: session.id
  });
  await enqueueAgentEvent({
    eventType: "ticket.call.transcript.ready",
    payload: {
      ...transcriptEvent,
      call: {
        id: session.id,
        transcriptR2Key: uploadedKey,
        transcriptUrl: transcriptUrlValue,
        sequence: transcriptEventMeta.sequence,
        eventType: "transcript_ready",
        eventIdempotencyKey: transcriptEventMeta.eventIdempotencyKey
      }
    }
  });
  void deliverPendingAgentEvents().catch(() => {});

  if (uploadedKey) {
    await enqueueCallTranscriptAiJob({
      callSessionId: session.id,
      transcriptR2Key: uploadedKey,
      metadata: {
        source: "transcript_ready",
        ticketId: session.ticket_id,
        messageId: session.message_id,
        provider: providerValue,
        providerCallId: providerCallIdValue,
        transcriptAttachmentId: attachmentId
      }
    });
  }

  return {
    status: "attached" as const,
    callSessionId: session.id,
    transcriptR2Key: uploadedKey,
    attachmentId
  };
}

async function findActiveTicketForInboundPhone(phone: string) {
  const requesterKey = `voice:${phone}`;
  const result = await db.query<{ id: string; mailbox_id: string | null }>(
    `SELECT t.id, t.mailbox_id
     FROM tickets t
     WHERE t.merged_into_ticket_id IS NULL
       AND (
         t.requester_email = $1
         OR EXISTS (
           SELECT 1
           FROM messages m
           WHERE m.ticket_id = t.id
             AND m.channel IN ('voice', 'whatsapp')
             AND (
               m.from_email = $1
               OR lower(m.from_email) = lower($2)
               OR COALESCE(m.wa_contact, '') = $2
             )
         )
       )
     ORDER BY t.updated_at DESC
     LIMIT 1`,
    [requesterKey, phone]
  );
  return result.rows[0] ?? null;
}

export async function createOrUpdateInboundCall({
  provider,
  providerCallId,
  fromPhone,
  toPhone,
  status,
  occurredAt,
  durationSeconds,
  ticketId,
  metadata
}: {
  provider?: string | null;
  providerCallId?: string | null;
  fromPhone: string;
  toPhone?: string | null;
  status?: CallStatus | null;
  occurredAt?: Date;
  durationSeconds?: number | null;
  ticketId?: string | null;
  metadata?: Record<string, unknown> | null;
}) {
  const normalizedFrom = normalizeCallPhone(fromPhone);
  if (!normalizedFrom) {
    throw new Error("Invalid caller phone number.");
  }

  const normalizedTo = normalizeCallPhone(toPhone) ?? normalizeCallPhone(getSupportAddress()) ?? "unknown";
  const providerValue = readString(provider) ?? "pending";
  const providerCallIdValue = readString(providerCallId);
  const statusValue = parseStatus(status ?? undefined) ?? "ringing";
  const at = occurredAt ?? new Date();

  if (providerCallIdValue) {
    const existing = await getCallSessionByProvider(providerValue, providerCallIdValue);
    if (existing) {
      const updated = await updateCallSessionStatus({
        callSessionId: existing.id,
        provider: providerValue,
        providerCallId: providerCallIdValue,
        status: statusValue,
        occurredAt: at,
        durationSeconds,
        payload: metadata ?? null
      });
      return {
        status: "updated_existing" as const,
        callSessionId: existing.id,
        ticketId: existing.ticket_id,
        update: updated
      };
    }
  }

  const supportAddress = getSupportAddress();
  const mailbox = await getOrCreateMailbox(supportAddress, supportAddress);
  const inboundCustomer = await resolveOrCreateCustomerForInbound({
    inboundPhone: normalizedFrom
  });

  let resolvedTicketId = readString(ticketId);
  let resolvedMailboxId: string | null = null;
  if (!resolvedTicketId) {
    if (inboundCustomer?.customerId) {
      const customerTicket = await db.query<{ id: string; mailbox_id: string | null }>(
        `SELECT id, mailbox_id
         FROM tickets
         WHERE customer_id = $1
           AND merged_into_ticket_id IS NULL
         ORDER BY updated_at DESC
         LIMIT 1`,
        [inboundCustomer.customerId]
      );
      resolvedTicketId = customerTicket.rows[0]?.id ?? null;
      resolvedMailboxId = customerTicket.rows[0]?.mailbox_id ?? null;
    }
  }
  if (!resolvedTicketId) {
    const byPhone = await findActiveTicketForInboundPhone(normalizedFrom);
    resolvedTicketId = byPhone?.id ?? null;
    resolvedMailboxId = byPhone?.mailbox_id ?? null;
  }

  let createdTicket = false;
  if (!resolvedTicketId) {
    const subject = `Inbound call from ${normalizedFrom}`;
    const inferredTags = inferTagsFromText({ subject, text: null });
    resolvedTicketId = await createTicket({
      mailboxId: mailbox.id,
      customerId: inboundCustomer?.customerId ?? null,
      requesterEmail: `voice:${normalizedFrom}`,
      subject,
      category: inferredTags[0] ?? "general",
      metadata: {
        channel: "voice",
        inboundPhone: normalizedFrom,
        provider: providerValue,
        ...(metadata ?? {})
      }
    });
    resolvedMailboxId = mailbox.id;
    createdTicket = true;
    await recordTicketEvent({ ticketId: resolvedTicketId, eventType: "ticket_created" });
    if (inferredTags.length) {
      await addTagsToTicket(resolvedTicketId, inferredTags);
      await recordTicketEvent({
        ticketId: resolvedTicketId,
        eventType: "tags_assigned",
        data: { tags: inferredTags }
      });
    }
  } else {
    if (!resolvedMailboxId) {
      const existingTicket = await db.query<{ mailbox_id: string | null }>(
        `SELECT mailbox_id
         FROM tickets
         WHERE id = $1
         LIMIT 1`,
        [resolvedTicketId]
      );
      resolvedMailboxId = existingTicket.rows[0]?.mailbox_id ?? null;
    }
    await reopenTicketIfNeeded(resolvedTicketId);
    if (inboundCustomer?.customerId) {
      await attachCustomerToTicket(resolvedTicketId, inboundCustomer.customerId);
    }
  }
  const mailboxIdForTicket = resolvedMailboxId ?? mailbox.id;

  const callSessionId = randomUUID();
  const messageId = randomUUID();
  const preview = `Inbound call ${statusValue.replace(/_/g, " ")} from ${normalizedFrom}`.slice(0, 200);
  const threadId = providerCallIdValue ?? callSessionId;

  await db.query(
    `INSERT INTO messages (
      id, mailbox_id, ticket_id, direction, channel, message_id, thread_id,
      from_email, to_emails, subject, preview_text, received_at, is_read, metadata
    ) VALUES (
      $1, $2, $3, 'inbound', 'voice', $4, $5,
      $6, $7, $8, $9, $10, false, $11
    )`,
    [
      messageId,
      mailboxIdForTicket,
      resolvedTicketId,
      providerCallIdValue ?? `voice:${callSessionId}`,
      threadId,
      `voice:${normalizedFrom}`,
      [normalizedTo],
      "Inbound voice call",
      preview,
      at,
      {
        channel: "voice",
        provider: providerValue,
        callSessionId
      }
    ]
  );

  await db.query(
    `INSERT INTO call_sessions (
      id, provider, provider_call_id, ticket_id, mailbox_id, message_id, direction, status,
      from_phone, to_phone, queued_at, started_at, duration_seconds, created_by, metadata
    ) VALUES (
      $1, $2, $3, $4, $5, $6, 'inbound', $7,
      $8, $9, $10, $11, $12, 'system', $13
    )`,
    [
      callSessionId,
      providerValue,
      providerCallIdValue,
      resolvedTicketId,
      mailboxIdForTicket,
      messageId,
      statusValue,
      normalizedFrom,
      normalizedTo,
      at,
      statusValue === "in_progress" ? at : null,
      typeof durationSeconds === "number" ? Math.max(0, Math.floor(durationSeconds)) : null,
      metadata ?? {}
    ]
  );

  const inboundEventMeta = await appendCallEvent({
    queryExecutor: db,
    callSessionId,
    eventType: statusValue,
    occurredAt: at,
    payload: metadata ?? null
  });

  await recordTicketEvent({
    ticketId: resolvedTicketId,
    eventType: "call_received",
    data: {
      callSessionId,
      fromPhone: normalizedFrom,
      status: statusValue
    }
  });

  const inboundEvent = buildAgentEvent({
    eventType: "ticket.call.received",
    ticketId: resolvedTicketId,
    messageId,
    mailboxId: mailboxIdForTicket,
    excerpt: preview,
    threadId: callSessionId
  });
  await enqueueAgentEvent({
    eventType: "ticket.call.received",
    payload: {
      ...inboundEvent,
      call: {
        id: callSessionId,
        direction: "inbound",
        fromPhone: normalizedFrom,
        toPhone: normalizedTo,
        status: statusValue,
        sequence: inboundEventMeta.sequence,
        eventType: statusValue,
        eventIdempotencyKey: inboundEventMeta.eventIdempotencyKey
      }
    }
  });

  if (createdTicket) {
    const ticketEvent = buildAgentEvent({
      eventType: "ticket.created",
      ticketId: resolvedTicketId,
      mailboxId: mailboxIdForTicket,
      excerpt: preview,
      threadId: callSessionId
    });
    await enqueueAgentEvent({ eventType: "ticket.created", payload: ticketEvent });
  }
  void deliverPendingAgentEvents().catch(() => {});

  return {
    status: "created" as const,
    callSessionId,
    messageId,
    ticketId: resolvedTicketId,
    createdTicket
  };
}
