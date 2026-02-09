import { z } from "zod";
import { getAgentFromRequest } from "@/server/agents/auth";
import { createDraft } from "@/server/agents/drafts";
import { hasMailboxScope } from "@/server/agents/scopes";
import { isAutoSendAllowed } from "@/server/agents/policy";
import { recordAuditLog } from "@/server/audit";
import { db } from "@/server/db";
import { sendTicketReply } from "@/server/email/replies";
import { addTagsToTicket, getTicketById, recordTicketEvent } from "@/server/tickets";

const actionSchema = z.object({
  type: z.enum([
    "draft_reply",
    "send_reply",
    "set_tags",
    "set_priority",
    "assign_to",
    "request_human_review"
  ]),
  ticketId: z.string().uuid(),
  subject: z.string().optional().nullable(),
  text: z.string().optional().nullable(),
  html: z.string().optional().nullable(),
  tags: z.array(z.string()).optional().nullable(),
  priority: z.enum(["low", "normal", "high", "urgent"]).optional().nullable(),
  assignedUserId: z.string().uuid().nullable().optional(),
  confidence: z.number().min(0).max(1).optional().nullable(),
  metadata: z.record(z.unknown()).optional().nullable()
});

const payloadSchema = z.object({
  action: actionSchema.optional(),
  actions: z.array(actionSchema).max(10).optional()
});

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

  const results: Array<{ type: string; status: string; detail?: string }> = [];

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
        if (!action.text && !action.html) {
          results.push({ type: action.type, status: "failed", detail: "Missing draft body" });
          break;
        }
        await createDraft({
          integrationId: integration.id,
          ticketId: action.ticketId,
          subject: action.subject ?? null,
          bodyText: action.text ?? null,
          bodyHtml: action.html ?? null,
          confidence: action.confidence ?? null
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
          results.push({ type: action.type, status: "blocked", detail: "Outside working hours" });
          break;
        }
        try {
          await sendTicketReply({
            ticketId: action.ticketId,
            subject: action.subject ?? null,
            text: action.text ?? null,
            html: action.html ?? null,
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
      default:
        results.push({ type: action.type, status: "ignored" });
        break;
    }
  }

  return Response.json({ status: "ok", results });
}
