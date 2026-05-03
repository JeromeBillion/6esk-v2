import { z } from "zod";
import { getSessionUser } from "@/server/auth/session";
import { canManageTickets, isLeadAdmin } from "@/server/auth/roles";
import { getTicketById } from "@/server/tickets";
import { sendTicketReply } from "@/server/email/replies";
import { checkModuleEntitlement } from "@/server/tenant/module-guard";
import { recordModuleUsageEvent } from "@/server/module-metering";

const replySchema = z.object({
  text: z.string().optional().nullable(),
  html: z.string().optional().nullable(),
  subject: z.string().optional().nullable(),
  attachments: z
    .array(
      z.object({
        filename: z.string(),
        contentType: z.string().optional().nullable(),
        size: z.number().optional().nullable(),
        contentBase64: z.string()
      })
    )
    .optional()
    .nullable(),
  template: z
    .object({
      name: z.string(),
      language: z.string(),
      components: z.array(z.record(z.unknown())).optional()
    })
    .optional()
    .nullable(),
  recipient: z.string().optional().nullable()
});

function inferReplyModule(input: {
  requesterEmail: string | null | undefined;
  recipient: string | null | undefined;
  hasTemplate: boolean;
}) {
  if (input.hasTemplate) {
    return "whatsapp" as const;
  }

  const resolvedRecipient = (input.recipient ?? input.requesterEmail ?? "").trim().toLowerCase();
  if (resolvedRecipient.startsWith("whatsapp:")) {
    return "whatsapp" as const;
  }
  if (input.requesterEmail?.trim().toLowerCase().startsWith("whatsapp:")) {
    return "whatsapp" as const;
  }

  return "email" as const;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ ticketId: string }> }
) {
  const user = await getSessionUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!canManageTickets(user)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { ticketId } = await params;
  const ticket = await getTicketById(ticketId);
  if (!ticket) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const isAdmin = isLeadAdmin(user);
  if (!isAdmin && ticket.assigned_user_id !== user.id) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch (error) {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = replySchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json({ error: "Invalid payload" }, { status: 400 });
  }

  const { text, html, subject, template, attachments, recipient } = parsed.data;
  if (!text && !html && !template && !(attachments?.length ?? 0)) {
    return Response.json({ error: "Reply body required" }, { status: 400 });
  }

  const replyModule = inferReplyModule({
    requesterEmail: ticket.requester_email,
    recipient,
    hasTemplate: Boolean(template)
  });
  if (!(await checkModuleEntitlement(replyModule))) {
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
      ticketId,
      text,
      html,
      subject,
      attachments: attachments ?? null,
      template: template ?? null,
      recipient: recipient ?? null,
      actorUserId: user.id,
      origin: "human"
    });
    await recordModuleUsageEvent({
      moduleKey: replyModule,
      usageKind: "reply_sent",
      actorType: "human",
      metadata: {
        route: "/api/tickets/[ticketId]/replies",
        ticketId,
        messageId: result.messageId ?? null
      }
    });
    return Response.json({ status: "sent", id: result.messageId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to send reply";
    return Response.json({ error: "Failed to send reply", details: message }, { status: 502 });
  }
}
