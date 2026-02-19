import { z } from "zod";
import { getAgentFromRequest } from "@/server/agents/auth";
import { createDraft } from "@/server/agents/drafts";
import { hasMailboxScope } from "@/server/agents/scopes";
import { isAutoSendAllowed } from "@/server/agents/policy";
import { buildAgentEvent } from "@/server/agents/events";
import { deliverPendingAgentEvents, enqueueAgentEvent } from "@/server/agents/outbox";
import { recordAuditLog } from "@/server/audit";
import { db } from "@/server/db";
import { sendTicketReply } from "@/server/email/replies";
import { addTagsToTicket, getTicketById, recordTicketEvent } from "@/server/tickets";
import { mergeCustomers, MergeError, mergeTickets } from "@/server/merges";
import { createMergeReviewTask, MergeReviewError } from "@/server/merge-reviews";
import {
  getTicketCallOptions,
  queueOutboundCall,
  resolveCallPhoneForRequest
} from "@/server/calls/service";
import { deliverPendingCallEvents } from "@/server/calls/outbox";
import { getLatestVoiceConsentState } from "@/server/calls/consent";
import { evaluateVoiceCallPolicy } from "@/server/calls/policy";
import { redactPhoneNumber } from "@/server/calls/redaction";

const actionSchema = z.object({
  type: z.enum([
    "draft_reply",
    "send_reply",
    "initiate_call",
    "set_tags",
    "set_priority",
    "assign_to",
    "request_human_review",
    "merge_tickets",
    "merge_customers",
    "propose_merge"
  ]),
  ticketId: z.string().uuid(),
  subject: z.string().optional().nullable(),
  text: z.string().optional().nullable(),
  html: z.string().optional().nullable(),
  template: z
    .object({
      name: z.string(),
      language: z.string(),
      components: z.array(z.record(z.unknown())).optional()
    })
    .optional()
    .nullable(),
  tags: z.array(z.string()).optional().nullable(),
  priority: z.enum(["low", "normal", "high", "urgent"]).optional().nullable(),
  assignedUserId: z.string().uuid().nullable().optional(),
  sourceTicketId: z.string().uuid().optional().nullable(),
  targetTicketId: z.string().uuid().optional().nullable(),
  sourceCustomerId: z.string().uuid().optional().nullable(),
  targetCustomerId: z.string().uuid().optional().nullable(),
  reason: z.string().max(500).optional().nullable(),
  candidateId: z.string().optional().nullable(),
  toPhone: z.string().optional().nullable(),
  fromPhone: z.string().optional().nullable(),
  idempotencyKey: z.string().max(200).optional().nullable(),
  confidence: z.number().min(0).max(1).optional().nullable(),
  metadata: z.record(z.unknown()).optional().nullable()
});

const payloadSchema = z.object({
  action: actionSchema.optional(),
  actions: z.array(actionSchema).max(10).optional()
});

const DEFAULT_AGENT_MERGE_MIN_CONFIDENCE = 0.85;

function getAgentMergeMinConfidence() {
  const raw = Number.parseFloat(
    process.env.AGENT_MERGE_MIN_CONFIDENCE ?? `${DEFAULT_AGENT_MERGE_MIN_CONFIDENCE}`
  );
  if (Number.isNaN(raw)) {
    return DEFAULT_AGENT_MERGE_MIN_CONFIDENCE;
  }
  if (raw < 0) return 0;
  if (raw > 1) return 1;
  return raw;
}

function validateMergeSafety(
  action: { reason?: string | null; confidence?: number | null },
  minConfidence: number
) {
  if (!action.reason?.trim()) {
    return "Merge reason is required.";
  }
  if (typeof action.confidence !== "number") {
    return "Merge confidence is required.";
  }
  if (action.confidence < minConfidence) {
    return `Merge confidence ${action.confidence.toFixed(2)} is below minimum ${minConfidence.toFixed(2)}.`;
  }
  return null;
}

function normalizeEscalationTag(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return normalized || null;
}

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

function readOutOfHoursEscalation(policy: Record<string, unknown> | null | undefined) {
  if (!policy || typeof policy !== "object") {
    return { mode: "draft_only" as const, tag: null };
  }
  const escalation = policy.escalation;
  if (!escalation || typeof escalation !== "object") {
    return { mode: "draft_only" as const, tag: null };
  }
  const record = escalation as Record<string, unknown>;
  const mode = record.out_of_hours === "block" ? "block" : "draft_only";
  const tag = normalizeEscalationTag(record.tag);
  return { mode, tag };
}

export async function POST(request: Request) {
  const integration = await getAgentFromRequest(request);
  if (!integration) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (integration.status !== "active") {
    return Response.json({ error: "Integration paused" }, { status: 403 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch (error) {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = payloadSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json({ error: "Invalid payload" }, { status: 400 });
  }

  const actions = parsed.data.actions ?? (parsed.data.action ? [parsed.data.action] : []);
  if (actions.length === 0) {
    return Response.json({ error: "No actions provided" }, { status: 400 });
  }

  const results: Array<{
    type: string;
    status: string;
    detail?: string;
    data?: Record<string, unknown>;
  }> = [];
  const allowMergeActions =
    integration.capabilities?.allow_merge_actions === true ||
    integration.capabilities?.allowMergeActions === true;
  const allowVoiceActions =
    integration.capabilities?.allow_voice_actions === true ||
    integration.capabilities?.allowVoiceActions === true;
  const mergeMinConfidence = getAgentMergeMinConfidence();

  for (const action of actions) {
    const ticket = await getTicketById(action.ticketId);
    if (!ticket) {
      results.push({ type: action.type, status: "not_found" });
      continue;
    }

    if (!hasMailboxScope(integration, ticket.mailbox_id)) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }

    switch (action.type) {
      case "draft_reply": {
        if (!action.text && !action.html && !action.template) {
          results.push({ type: action.type, status: "failed", detail: "Missing draft body" });
          break;
        }
        const draftMetadata = action.template
          ? { ...(action.metadata ?? {}), template: action.template }
          : (action.metadata ?? null);
        await createDraft({
          integrationId: integration.id,
          ticketId: action.ticketId,
          subject: action.subject ?? null,
          bodyText: action.text ?? null,
          bodyHtml: action.html ?? null,
          confidence: action.confidence ?? null,
          metadata: draftMetadata
        });
        await recordTicketEvent({
          ticketId: action.ticketId,
          eventType: "ai_draft_created",
          data: { agentId: integration.id, confidence: action.confidence ?? null }
        });
        await recordAuditLog({
          action: "ai_draft_created",
          entityType: "ticket",
          entityId: action.ticketId,
          data: { agentId: integration.id }
        });
        results.push({ type: action.type, status: "ok" });
        break;
      }
      case "send_reply": {
        if (integration.policy_mode !== "auto_send") {
          results.push({ type: action.type, status: "blocked", detail: "Auto-send disabled" });
          break;
        }

        if (!isAutoSendAllowed(integration)) {
          const escalation = readOutOfHoursEscalation(integration.policy);
          if (escalation.mode === "draft_only" && (action.text || action.html || action.template)) {
            const draftMetadata = action.template
              ? { ...(action.metadata ?? {}), template: action.template }
              : (action.metadata ?? null);
            await createDraft({
              integrationId: integration.id,
              ticketId: action.ticketId,
              subject: action.subject ?? null,
              bodyText: action.text ?? null,
              bodyHtml: action.html ?? null,
              confidence: action.confidence ?? null,
              metadata: draftMetadata
            });
            await recordTicketEvent({
              ticketId: action.ticketId,
              eventType: "ai_draft_created",
              data: {
                agentId: integration.id,
                confidence: action.confidence ?? null,
                source: "out_of_hours_escalation"
              }
            });
            if (escalation.tag) {
              await addTagsToTicket(action.ticketId, [escalation.tag]);
              await recordTicketEvent({
                ticketId: action.ticketId,
                eventType: "tags_assigned",
                data: { tags: [escalation.tag], source: "out_of_hours_escalation" }
              });
            }
            await recordAuditLog({
              action: "ai_reply_escalated_out_of_hours",
              entityType: "ticket",
              entityId: action.ticketId,
              data: {
                agentId: integration.id,
                escalationMode: escalation.mode,
                escalationTag: escalation.tag
              }
            });
            results.push({
              type: action.type,
              status: "blocked",
              detail: escalation.tag
                ? `Outside working hours; draft created and tagged ${escalation.tag}`
                : "Outside working hours; draft created for review"
            });
            break;
          }
          results.push({ type: action.type, status: "blocked", detail: "Outside working hours" });
          break;
        }
        try {
          await sendTicketReply({
            ticketId: action.ticketId,
            subject: action.subject ?? null,
            text: action.text ?? null,
            html: action.html ?? null,
            template: action.template ?? null,
            origin: "ai",
            aiMeta: {
              agentId: integration.id,
              confidence: action.confidence ?? null,
              metadata: action.metadata ?? null
            }
          });
          await recordAuditLog({
            action: "ai_reply_sent",
            entityType: "ticket",
            entityId: action.ticketId,
            data: { agentId: integration.id }
          });
          results.push({ type: action.type, status: "ok" });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Failed to send";
          results.push({ type: action.type, status: "failed", detail: message });
        }
        break;
      }
      case "initiate_call": {
        if (!allowVoiceActions) {
          results.push({
            type: action.type,
            status: "blocked",
            detail: "Voice actions disabled"
          });
          break;
        }

        if (!action.reason?.trim()) {
          results.push({
            type: action.type,
            status: "failed",
            detail: "Call reason is required."
          });
          break;
        }

        const callOptions = await getTicketCallOptions(action.ticketId);
        if (!callOptions) {
          results.push({
            type: action.type,
            status: "not_found",
            detail: "Ticket not found."
          });
          break;
        }

        const resolved = resolveCallPhoneForRequest({
          options: callOptions,
          candidateId: action.candidateId ?? null,
          toPhone: action.toPhone ?? null
        });

        if (resolved.status === "selection_required") {
          results.push({
            type: action.type,
            status: "selection_required",
            detail: resolved.detail,
            data: {
              defaultCandidateId: resolved.defaultCandidateId,
              candidates: resolved.candidates
            }
          });
          break;
        }

        if (resolved.status === "failed") {
          results.push({
            type: action.type,
            status: "failed",
            detail: resolved.detail
          });
          break;
        }

        const aiDefaultMaxCallsPerHour = Number(process.env.CALLS_AI_MAX_CALLS_PER_HOUR ?? "0");
        const consentState = await getLatestVoiceConsentState({
          customerId: ticket.customer_id ?? null,
          phone: resolved.phone,
          email: requesterEmailForConsent(ticket.requester_email)
        });
        const policyCheck = await evaluateVoiceCallPolicy({
          actor: "ai",
          policy: integration.policy ?? null,
          ticketMetadata: (ticket.metadata as Record<string, unknown> | null) ?? null,
          consentState,
          selectedCandidateId: resolved.selectedCandidateId ?? null,
          actorIntegrationId: integration.id,
          defaultMaxCallsPerHour: Number.isFinite(aiDefaultMaxCallsPerHour)
            ? aiDefaultMaxCallsPerHour
            : null
        });
        if (!policyCheck.allowed) {
          results.push({
            type: action.type,
            status: "blocked",
            detail: policyCheck.detail,
            data: { errorCode: policyCheck.code }
          });
          break;
        }

        try {
          const queued = await queueOutboundCall({
            ticketId: action.ticketId,
            toPhone: resolved.phone,
            fromPhone: action.fromPhone ?? null,
            reason: action.reason,
            idempotencyKey: action.idempotencyKey ?? null,
            origin: "ai",
            actorIntegrationId: integration.id,
            metadata: {
              ...(action.metadata ?? {}),
              selectedCandidateId: resolved.selectedCandidateId
              }
            });
          void deliverPendingCallEvents({ limit: 5 }).catch(() => {});
          await recordAuditLog({
            action: "ai_call_queued",
            entityType: "call_session",
            entityId: queued.callSessionId,
            data: {
              agentId: integration.id,
              ticketId: action.ticketId,
              toPhone: redactPhoneNumber(queued.toPhone),
              idempotent: queued.idempotent
            }
          });
          results.push({
            type: action.type,
            status: "ok",
            data: {
              callSessionId: queued.callSessionId,
              messageId: queued.messageId,
              toPhone: queued.toPhone,
              idempotent: queued.idempotent
            }
          });
        } catch (error) {
          const detail =
            error instanceof Error ? error.message : "Failed to queue outbound voice call";
          results.push({
            type: action.type,
            status: "failed",
            detail
          });
        }
        break;
      }
      case "set_tags": {
        const tags = action.tags ?? [];
        if (!tags.length) {
          results.push({ type: action.type, status: "failed", detail: "No tags provided" });
          break;
        }
        await addTagsToTicket(action.ticketId, tags);
        await recordTicketEvent({
          ticketId: action.ticketId,
          eventType: "tags_assigned",
          data: { tags }
        });
        await recordAuditLog({
          action: "ai_tags_set",
          entityType: "ticket",
          entityId: action.ticketId,
          data: { agentId: integration.id, tags }
        });
        results.push({ type: action.type, status: "ok" });
        break;
      }
      case "set_priority": {
        if (!action.priority) {
          results.push({ type: action.type, status: "failed", detail: "Missing priority" });
          break;
        }
        await db.query("UPDATE tickets SET priority = $1, updated_at = now() WHERE id = $2", [
          action.priority,
          action.ticketId
        ]);
        await recordTicketEvent({
          ticketId: action.ticketId,
          eventType: "priority_updated",
          data: { to: action.priority }
        });
        await recordAuditLog({
          action: "ai_priority_set",
          entityType: "ticket",
          entityId: action.ticketId,
          data: { agentId: integration.id, priority: action.priority }
        });
        results.push({ type: action.type, status: "ok" });
        break;
      }
      case "assign_to": {
        await db.query(
          "UPDATE tickets SET assigned_user_id = $1, updated_at = now() WHERE id = $2",
          [action.assignedUserId ?? null, action.ticketId]
        );
        await recordTicketEvent({
          ticketId: action.ticketId,
          eventType: "assignment_updated",
          data: { to: action.assignedUserId ?? null }
        });
        await recordAuditLog({
          action: "ai_assignment_set",
          entityType: "ticket",
          entityId: action.ticketId,
          data: { agentId: integration.id, assignedUserId: action.assignedUserId ?? null }
        });
        results.push({ type: action.type, status: "ok" });
        break;
      }
      case "request_human_review": {
        await recordTicketEvent({
          ticketId: action.ticketId,
          eventType: "ai_review_requested",
          data: action.metadata ?? null
        });
        await recordAuditLog({
          action: "ai_review_requested",
          entityType: "ticket",
          entityId: action.ticketId,
          data: { agentId: integration.id, metadata: action.metadata ?? null }
        });
        results.push({ type: action.type, status: "ok" });
        break;
      }
      case "propose_merge": {
        const hasCustomerPair = Boolean(action.sourceCustomerId && action.targetCustomerId);
        const proposedSourceTicketId = action.sourceTicketId ?? action.ticketId;
        const hasTicketPair = Boolean(proposedSourceTicketId && action.targetTicketId);

        if (hasCustomerPair && hasTicketPair) {
          results.push({
            type: action.type,
            status: "failed",
            detail: "Provide either ticket merge fields or customer merge fields, not both."
          });
          break;
        }
        if (!hasCustomerPair && !hasTicketPair) {
          results.push({
            type: action.type,
            status: "failed",
            detail:
              "Missing merge proposal target. Provide source/target ticket ids or source/target customer ids."
          });
          break;
        }
        const mergeSafetyError = validateMergeSafety(action, mergeMinConfidence);
        if (mergeSafetyError) {
          results.push({ type: action.type, status: "failed", detail: mergeSafetyError });
          break;
        }

        let reviewTaskId: string | null = null;
        let reviewProposalType: "ticket" | "customer" = hasCustomerPair ? "customer" : "ticket";
        let sourceTicketId: string | null = null;
        let targetTicketId: string | null = null;
        let sourceCustomerId: string | null = null;
        let targetCustomerId: string | null = null;
        let targetTicketMailboxId: string | null = null;

        if (hasCustomerPair) {
          sourceCustomerId = action.sourceCustomerId ?? null;
          targetCustomerId = action.targetCustomerId ?? null;
        } else {
          sourceTicketId = proposedSourceTicketId;
          targetTicketId = action.targetTicketId ?? null;
          if (!sourceTicketId || !targetTicketId) {
            results.push({
              type: action.type,
              status: "failed",
              detail: "Missing source or target ticket id for merge proposal."
            });
            break;
          }

          const targetTicket = await getTicketById(targetTicketId);
          if (!targetTicket) {
            results.push({
              type: action.type,
              status: "not_found",
              detail: "Target ticket not found for merge proposal."
            });
            break;
          }
          targetTicketMailboxId = targetTicket.mailbox_id;
          if (
            !hasMailboxScope(integration, ticket.mailbox_id) ||
            !hasMailboxScope(integration, targetTicket.mailbox_id)
          ) {
            return Response.json({ error: "Forbidden" }, { status: 403 });
          }
        }

        try {
          const reviewTask = await createMergeReviewTask({
            proposalType: reviewProposalType,
            ticketId: action.ticketId,
            sourceTicketId,
            targetTicketId,
            sourceCustomerId,
            targetCustomerId,
            reason: action.reason ?? null,
            confidence: action.confidence ?? null,
            metadata: action.metadata ?? null,
            proposedByAgentId: integration.id
          });
          reviewTaskId = reviewTask.id;
        } catch (error) {
          const detail =
            error instanceof MergeReviewError
              ? error.message
              : error instanceof Error
                ? error.message
                : "Failed to create merge review task";
          results.push({ type: action.type, status: "failed", detail });
          break;
        }

        await recordTicketEvent({
          ticketId: action.ticketId,
          eventType: "ai_merge_proposed",
          data: {
            reviewTaskId,
            proposalType: reviewProposalType,
            sourceTicketId,
            targetTicketId,
            sourceCustomerId,
            targetCustomerId,
            metadata: action.metadata ?? null,
            confidence: action.confidence ?? null,
            reason: action.reason ?? null
          }
        });
        await recordAuditLog({
          action: "ai_merge_proposed",
          entityType: "ticket",
          entityId: action.ticketId,
          data: {
            agentId: integration.id,
            reviewTaskId,
            proposalType: reviewProposalType,
            sourceTicketId,
            targetTicketId,
            sourceCustomerId,
            targetCustomerId,
            metadata: action.metadata ?? null,
            confidence: action.confidence ?? null,
            reason: action.reason ?? null
          }
        });

        const reviewEvent = buildAgentEvent({
          eventType: "merge.review.required",
          ticketId: action.ticketId,
          mailboxId: targetTicketMailboxId ?? ticket.mailbox_id,
          excerpt:
            reviewProposalType === "ticket"
              ? `Merge review required for tickets ${sourceTicketId} -> ${targetTicketId}`
              : `Merge review required for customers ${sourceCustomerId} -> ${targetCustomerId}`
        });
        await enqueueAgentEvent({
          eventType: "merge.review.required",
          payload: {
            ...reviewEvent,
            review: {
              id: reviewTaskId,
              proposalType: reviewProposalType,
              sourceTicketId,
              targetTicketId,
              sourceCustomerId,
              targetCustomerId,
              confidence: action.confidence ?? null,
              reason: action.reason ?? null
            }
          }
        });
        void deliverPendingAgentEvents().catch(() => {});

        results.push({ type: action.type, status: "ok" });
        break;
      }
      case "merge_tickets": {
        if (!allowMergeActions) {
          results.push({ type: action.type, status: "blocked", detail: "Merge actions disabled" });
          break;
        }
        const sourceTicketId = action.sourceTicketId ?? action.ticketId;
        const targetTicketId = action.targetTicketId;
        if (!targetTicketId) {
          results.push({ type: action.type, status: "failed", detail: "Missing target ticket id" });
          break;
        }
        const mergeSafetyError = validateMergeSafety(action, mergeMinConfidence);
        if (mergeSafetyError) {
          results.push({ type: action.type, status: "failed", detail: mergeSafetyError });
          break;
        }

        const targetTicket = await getTicketById(targetTicketId);
        if (!targetTicket) {
          results.push({ type: action.type, status: "not_found", detail: "Target ticket not found" });
          break;
        }

        if (
          !hasMailboxScope(integration, ticket.mailbox_id) ||
          !hasMailboxScope(integration, targetTicket.mailbox_id)
        ) {
          return Response.json({ error: "Forbidden" }, { status: 403 });
        }

        try {
          const result = await mergeTickets({
            sourceTicketId,
            targetTicketId,
            actorUserId: null,
            reason: action.reason ?? null
          });
          await recordAuditLog({
            action: "ai_ticket_merged",
            entityType: "ticket",
            entityId: sourceTicketId,
            data: { agentId: integration.id, result }
          });
          results.push({ type: action.type, status: "ok" });
        } catch (error) {
          const detail =
            error instanceof MergeError
              ? error.message
              : error instanceof Error
                ? error.message
                : "Failed to merge tickets";
          results.push({ type: action.type, status: "failed", detail });
        }
        break;
      }
      case "merge_customers": {
        if (!allowMergeActions) {
          results.push({ type: action.type, status: "blocked", detail: "Merge actions disabled" });
          break;
        }
        const sourceCustomerId = action.sourceCustomerId;
        const targetCustomerId = action.targetCustomerId;
        if (!sourceCustomerId || !targetCustomerId) {
          results.push({ type: action.type, status: "failed", detail: "Missing customer ids" });
          break;
        }
        const mergeSafetyError = validateMergeSafety(action, mergeMinConfidence);
        if (mergeSafetyError) {
          results.push({ type: action.type, status: "failed", detail: mergeSafetyError });
          break;
        }
        try {
          const result = await mergeCustomers({
            sourceCustomerId,
            targetCustomerId,
            actorUserId: null,
            reason: action.reason ?? null
          });
          await recordAuditLog({
            action: "ai_customer_merged",
            entityType: "ticket",
            entityId: action.ticketId,
            data: { agentId: integration.id, result }
          });
          results.push({ type: action.type, status: "ok" });
        } catch (error) {
          const detail =
            error instanceof MergeError
              ? error.message
              : error instanceof Error
                ? error.message
                : "Failed to merge customers";
          results.push({ type: action.type, status: "failed", detail });
        }
        break;
      }
      default:
        results.push({ type: action.type, status: "ignored" });
        break;
    }
  }

  return Response.json({ status: "ok", results });
}
