import { z } from "zod";
import { getSessionUser } from "@/server/auth/session";
import { canManageTickets } from "@/server/auth/roles";
import { recordAuditLog } from "@/server/audit";
import { queueWhatsAppSend } from "@/server/whatsapp/send";
import { getWhatsAppWindowStatus } from "@/server/whatsapp/window";

const payloadSchema = z.object({
  ticketId: z.string().uuid().optional().nullable(),
  to: z.string().min(3),
  text: z.string().optional(),
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
});

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!canManageTickets(user)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch (error) {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = payloadSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Invalid payload" }, { status: 400 });
  }

  if (!parsed.data.text && !parsed.data.template && !(parsed.data.attachments?.length ?? 0)) {
    return Response.json({ error: "Message body required" }, { status: 400 });
  }

  if (parsed.data.ticketId) {
    const windowStatus = await getWhatsAppWindowStatus(parsed.data.ticketId);
    if (!windowStatus.isOpen && !parsed.data.template) {
      return Response.json(
        { error: "WhatsApp 24h window closed. Template required." },
        { status: 409 }
      );
    }
  }

  try {
    await queueWhatsAppSend({
      ticketId: parsed.data.ticketId ?? null,
      to: parsed.data.to,
      text: parsed.data.text ?? "[template message queued]",
      attachments: parsed.data.attachments ?? null,
      template: parsed.data.template ?? null,
      actorUserId: user.id,
      origin: "human"
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to queue WhatsApp message";
    return Response.json({ error: message }, { status: 409 });
  }

  await recordAuditLog({
    actorUserId: user.id,
    action: "whatsapp_send_queued",
    entityType: "whatsapp",
    data: { to: parsed.data.to, ticketId: parsed.data.ticketId ?? null }
  });

  return Response.json({ status: "queued" });
}
