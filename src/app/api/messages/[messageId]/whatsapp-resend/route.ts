import { getSessionUser } from "@/server/auth/session";
import { canManageTickets, isLeadAdmin } from "@/server/auth/roles";
import { recordAuditLog } from "@/server/audit";
import { db } from "@/server/db";
import { getMessageById, getTicketAssignment, hasMailboxAccess } from "@/server/messages";
import { getObjectBuffer } from "@/server/storage/r2";
import { getWhatsAppWindowStatus } from "@/server/whatsapp/window";
import { checkModuleEntitlement } from "@/server/tenant/module-guard";
import { recordModuleUsageEvent } from "@/server/module-metering";

function normalizeContact(value: string | null | undefined) {
  if (!value) return "";
  return value.replace(/^whatsapp:/, "").replace(/\s+/g, "").trim();
}

function extractTemplate(payload: Record<string, unknown> | null) {
  const template = payload && typeof payload.template === "object" && payload.template
    ? (payload.template as Record<string, unknown>)
    : null;
  return template;
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ messageId: string }> }
) {
  const user = await getSessionUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!canManageTickets(user)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!(await checkModuleEntitlement("whatsapp"))) {
    return Response.json(
      {
        error: "WhatsApp module is not enabled for this workspace.",
        code: "module_disabled",
        module: "whatsapp"
      },
      { status: 409 }
    );
  }

  const { messageId } = await params;
  const message = await getMessageById(messageId);
  if (!message) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const isAdmin = isLeadAdmin(user);
  if (!isAdmin) {
    if (message.ticket_id) {
      const assignedUserId = await getTicketAssignment(message.ticket_id);
      if (!assignedUserId || assignedUserId !== user.id) {
        return Response.json({ error: "Forbidden" }, { status: 403 });
      }
    } else {
      const allowed = await hasMailboxAccess(user.id, message.mailbox_id);
      if (!allowed) {
        return Response.json({ error: "Forbidden" }, { status: 403 });
      }
    }
  }

  if (message.channel !== "whatsapp" || message.direction !== "outbound") {
    return Response.json({ error: "Only outbound WhatsApp messages can be resent" }, { status: 400 });
  }

  const statusResult = await db.query<{ status: string | null }>(
    `SELECT status
     FROM whatsapp_status_events
     WHERE message_id = $1 OR external_message_id = $2
     ORDER BY occurred_at DESC
     LIMIT 1`,
    [message.id, message.external_message_id ?? null]
  );
  const latestStatus = (statusResult.rows[0]?.status ?? message.wa_status ?? "").toLowerCase();
  if (latestStatus !== "failed") {
    return Response.json({ error: "Only failed messages can be resent" }, { status: 409 });
  }

  const eventResult = await db.query<{ payload: Record<string, unknown> }>(
    `SELECT payload
     FROM whatsapp_events
     WHERE direction = 'outbound'
       AND (payload->>'messageRecordId') = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [message.id]
  );
  const priorPayload = eventResult.rows[0]?.payload ?? null;

  let to = normalizeContact(typeof priorPayload?.to === "string" ? priorPayload.to : null);
  if (!to) {
    const fallback = Array.isArray(message.to_emails) ? message.to_emails[0] : null;
    to = normalizeContact(message.wa_contact ?? fallback ?? null);
  }

  let template = extractTemplate(priorPayload);
  let text = typeof priorPayload?.text === "string" ? priorPayload.text : null;
  const attachmentsResult = await db.query<{
    filename: string;
    content_type: string | null;
    size_bytes: number | null;
    r2_key: string;
  }>(
    `SELECT filename, content_type, size_bytes, r2_key
     FROM attachments
     WHERE message_id = $1
     ORDER BY created_at`,
    [message.id]
  );
  const attachments = attachmentsResult.rows.map((row) => ({
    filename: row.filename,
    contentType: row.content_type,
    size: row.size_bytes,
    r2Key: row.r2_key
  }));

  if (!text && !template && message.r2_key_text) {
    const { buffer } = await getObjectBuffer(message.r2_key_text);
    const body = buffer.toString("utf-8").trim();
    if (body && !/^template:/i.test(body) && body !== "[whatsapp template]") {
      text = body;
    }
  }

  if (!to) {
    return Response.json({ error: "Missing WhatsApp recipient" }, { status: 400 });
  }

  if (!text && !template && attachments.length === 0) {
    return Response.json({ error: "Unable to reconstruct message payload" }, { status: 409 });
  }

  if (message.ticket_id) {
    const windowStatus = await getWhatsAppWindowStatus(message.ticket_id);
    if (!windowStatus.isOpen && !template) {
      return Response.json(
        { error: "WhatsApp 24h window closed. Template required." },
        { status: 409 }
      );
    }
  }

  const payload = {
    to,
    text: text ?? null,
    caption: attachments.length ? text ?? null : null,
    attachments: attachments.length ? attachments : null,
    template: template ?? null,
    ticketId: message.ticket_id ?? null,
    messageRecordId: message.id,
    mailboxId: message.mailbox_id,
    provider: message.provider ?? null,
    resend: true
  };

  await db.query(
    `INSERT INTO whatsapp_events (direction, payload, status)
     VALUES ($1, $2, $3)`,
    ["outbound", payload, "queued"]
  );

  const now = new Date();
  await db.query(
    `INSERT INTO whatsapp_status_events (message_id, external_message_id, status, occurred_at, payload)
     VALUES ($1, $2, $3, $4, $5)`,
    [message.id, message.external_message_id ?? null, "queued", now, { source: "resend", status: "queued" }]
  );

  await db.query(
    `UPDATE messages
     SET wa_status = 'queued',
         wa_timestamp = $1,
         sent_at = $1
     WHERE id = $2`,
    [now, message.id]
  );

  await recordAuditLog({
    actorUserId: user.id,
    action: "whatsapp_resend_queued",
    entityType: "message",
    entityId: message.id,
    data: { ticketId: message.ticket_id ?? null, to }
  });
  await recordModuleUsageEvent({
    moduleKey: "whatsapp",
    usageKind: "resend_queued",
    actorType: "human",
    metadata: {
      route: "/api/messages/[messageId]/whatsapp-resend",
      ticketId: message.ticket_id ?? null,
      messageId: message.id,
      to
    }
  });

  return Response.json({ status: "queued" });
}
