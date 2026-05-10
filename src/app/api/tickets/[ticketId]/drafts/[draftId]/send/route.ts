import { getSessionUser } from "@/server/auth/session";
import { canManageTickets, isLeadAdmin } from "@/server/auth/roles";
import { recordAuditLog } from "@/server/audit";
import { getDraftById, updateDraftStatus } from "@/server/agents/drafts";
import { sendTicketReply } from "@/server/email/replies";
import { getTicketById, recordTicketEvent } from "@/server/tickets";
import { recordModuleUsageEvent, resolveAiProviderMode } from "@/server/module-metering";
import { checkModuleEntitlement } from "@/server/tenant/module-guard";
import { DEFAULT_TENANT_ID } from "@/server/tenant/types";

function inferDraftReplyModule(input: {
  requesterEmail: string | null | undefined;
  hasTemplate: boolean;
}) {
  if (input.hasTemplate) {
    return "whatsapp" as const;
  }
  const requester = input.requesterEmail?.trim().toLowerCase() ?? "";
  return requester.startsWith("whatsapp:") ? ("whatsapp" as const) : ("email" as const);
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ ticketId: string; draftId: string }> }
) {
  const user = await getSessionUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!canManageTickets(user)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { ticketId, draftId } = await params;
  const tenantId = user.tenant_id ?? DEFAULT_TENANT_ID;
  const ticket = await getTicketById(ticketId, tenantId);
  if (!ticket) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const isAdmin = isLeadAdmin(user);
  if (!isAdmin && ticket.assigned_user_id !== user.id) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const draft = await getDraftById({ ticketId, draftId, tenantId });
  if (!draft) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  if (draft.status !== "pending") {
    return Response.json({ error: "Draft is no longer pending" }, { status: 409 });
  }

  if (!draft.body_text && !draft.body_html) {
    const template = draft.metadata && typeof draft.metadata === "object"
      ? (draft.metadata as Record<string, unknown>).template
      : null;
    if (!template) {
      return Response.json({ error: "Draft body required" }, { status: 400 });
    }
  }

  const template =
    draft.metadata && typeof draft.metadata === "object"
      ? (draft.metadata as Record<string, unknown>).template ?? null
      : null;
  const replyModule = inferDraftReplyModule({
    requesterEmail: ticket.requester_email,
    hasTemplate: Boolean(template)
  });
  if (!(await checkModuleEntitlement(replyModule, tenantId))) {
    const label = replyModule === "whatsapp" ? "WhatsApp" : "Email";
    return Response.json(
      {
        error: `${label} module is not enabled for this workspace.`,
        code: "module_disabled",
        module: replyModule
      },
      { status: 409 }
    );
  }

  try {
    const result = await sendTicketReply({
      tenantId,
      ticketId,
      text: draft.body_text,
      html: draft.body_html,
      subject: draft.subject,
      template: template && typeof template === "object" ? (template as Record<string, unknown>) : null,
      actorUserId: user.id,
      origin: "ai",
      aiMeta: {
        draftId,
        integrationId: draft.integration_id,
        approvedBy: user.id
      }
    });

    const updated = await updateDraftStatus({
      draftId,
      ticketId,
      tenantId,
      status: "used"
    });

    if (!updated) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }

    await recordTicketEvent({
      tenantId,
      ticketId,
      eventType: "ai_draft_used",
      actorUserId: user.id,
      data: { draftId }
    });
    await recordAuditLog({
      tenantId,
      actorUserId: user.id,
      action: "ai_draft_used",
      entityType: "agent_draft",
      entityId: draftId,
      data: { ticketId }
    });
    await recordModuleUsageEvent({
      tenantId,
      moduleKey: replyModule,
      usageKind: "reply_sent",
      actorType: "human",
      metadata: {
        route: "/api/tickets/[ticketId]/drafts/[draftId]/send",
        ticketId,
        draftId,
        messageId: result.messageId ?? null,
        source: "approved_ai_draft"
      }
    });
    await recordModuleUsageEvent({
      tenantId,
      moduleKey: "aiAutomation",
      usageKind: "approved_draft_send",
      actorType: "ai",
      providerMode: resolveAiProviderMode(
        draft.metadata && typeof draft.metadata === "object"
          ? (draft.metadata as Record<string, unknown>)
          : null
      ),
      metadata: {
        route: "/api/tickets/[ticketId]/drafts/[draftId]/send",
        ticketId,
        draftId,
        integrationId: draft.integration_id,
        messageId: result.messageId ?? null,
        channel: replyModule
      }
    });

    return Response.json({ status: "sent", messageId: result.messageId, draft: updated });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to send reply";
    return Response.json({ error: "Failed to send reply", details: message }, { status: 502 });
  }
}
