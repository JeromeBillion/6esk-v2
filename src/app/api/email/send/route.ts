import { randomUUID } from "crypto";
import { outboundEmailSchema } from "@/server/email/schema";
import { normalizeAddressList, sanitizeFilename } from "@/server/email/normalize";
import { findMailbox, getOrCreateMailbox } from "@/server/email/mailbox";
import { enqueueEmailOutboxEvent } from "@/server/email/outbox";
import { isMailDraftRecord } from "@/server/email/drafts";
import { db } from "@/server/db";
import { putObject } from "@/server/storage/r2";
import { getSessionUser } from "@/server/auth/session";
import { canManageTickets, isLeadAdmin } from "@/server/auth/roles";
import { getMessageById, hasMailboxAccess } from "@/server/messages";
import { checkModuleEntitlement } from "@/server/tenant/module-guard";
import { recordModuleUsageEvent } from "@/server/module-metering";

function buildOutboundMessageId(fromEmail: string) {
  const domain = fromEmail.split("@")[1]?.trim().toLowerCase() || "6esk.local";
  return `<${randomUUID()}@${domain}>`;
}

function normalizeReferenceList(values?: string[] | null) {
  if (!values?.length) {
    return [];
  }
  return Array.from(
    new Set(
      values
        .map((value) => value.trim())
        .filter(Boolean)
    )
  );
}

function getSupportAddress() {
  const explicit = process.env.SUPPORT_ADDRESS;
  if (explicit) {
    return explicit.toLowerCase();
  }
  const domain = process.env.RESEND_FROM_DOMAIN ?? "";
  return domain ? `support@${domain}`.toLowerCase() : "";
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!canManageTickets(user)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!(await checkModuleEntitlement("email"))) {
    return Response.json(
      {
        error: "Email module is not enabled for this workspace.",
        code: "module_disabled",
        module: "email"
      },
      { status: 409 }
    );
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch (error) {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = outboundEmailSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid payload", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const data = parsed.data;
  const toList = normalizeAddressList(data.to);
  const ccList = normalizeAddressList(data.cc ?? undefined);
  const bccList = normalizeAddressList(data.bcc ?? undefined);
  const fromEmail = normalizeAddressList(data.from)[0];

  if (!fromEmail || toList.length === 0) {
    return Response.json({ error: "Missing from/to addresses" }, { status: 400 });
  }

  const supportAddress = getSupportAddress();
  let mailbox = await findMailbox(fromEmail);
  if (!mailbox) {
    if (!isLeadAdmin(user)) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }
    mailbox = await getOrCreateMailbox(fromEmail, supportAddress);
  } else if (!isLeadAdmin(user)) {
    const allowed = await hasMailboxAccess(user.id, mailbox.id);
    if (!allowed) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  if (data.draftId) {
    const draft = await getMessageById(data.draftId);
    if (!draft || draft.mailbox_id !== mailbox.id || !isMailDraftRecord(draft)) {
      return Response.json({ error: "Draft not found" }, { status: 404 });
    }
  }

  const inReplyTo = data.inReplyTo?.trim() || null;
  const references = normalizeReferenceList([
    ...(data.references ?? []),
    ...(inReplyTo ? [inReplyTo] : [])
  ]);
  const outboundMessageId = buildOutboundMessageId(fromEmail);
  const messageId = data.draftId ?? randomUUID();
  const threadId =
    data.threadId?.trim() ||
    references[0] ||
    outboundMessageId;

  const previewText = (data.text ?? "").replace(/\s+/g, " ").trim().slice(0, 200) || null;

  if (data.draftId) {
    await db.query(
      `UPDATE messages
       SET message_id = $1,
           thread_id = $2,
           in_reply_to = $3,
           reference_ids = $4,
           external_message_id = NULL,
           provider = 'resend',
           from_email = $5,
           to_emails = $6,
           cc_emails = $7,
           bcc_emails = $8,
           subject = $9,
           preview_text = $10,
           sent_at = NULL,
           is_read = true,
           metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
             'mail_state', 'queued',
             'queued_at', now()::text,
             'last_send_error', NULL
           )
       WHERE id = $11`,
      [
        outboundMessageId,
        threadId,
        inReplyTo,
        references.length ? references : null,
        fromEmail,
        toList,
        ccList,
        bccList,
        data.subject,
        previewText,
        messageId
      ]
    );
  } else {
    await db.query(
      `INSERT INTO messages (
        id, mailbox_id, direction, message_id, thread_id, in_reply_to, reference_ids, external_message_id, provider, from_email,
        to_emails, cc_emails, bcc_emails, subject, preview_text, sent_at, is_read, metadata
      ) VALUES (
        $1, $2, 'outbound', $3, $4, $5, $6, NULL, 'resend', $7,
        $8, $9, $10, $11, $12, NULL, true,
        jsonb_build_object('mail_state', 'queued', 'queued_at', now()::text)
      )`,
      [
        messageId,
        mailbox.id,
        outboundMessageId,
        threadId,
        inReplyTo,
        references.length ? references : null,
        fromEmail,
        toList,
        ccList,
        bccList,
        data.subject,
        previewText
      ]
    );
  }

  const keyPrefix = `messages/${messageId}`;
  let textKey: string | null = null;
  let htmlKey: string | null = null;
  let sizeBytes = 0;

  if (data.text) {
    textKey = await putObject({
      key: `${keyPrefix}/body.txt`,
      body: data.text,
      contentType: "text/plain; charset=utf-8"
    });
    sizeBytes += Buffer.byteLength(data.text);
  }

  if (data.html) {
    htmlKey = await putObject({
      key: `${keyPrefix}/body.html`,
      body: data.html,
      contentType: "text/html; charset=utf-8"
    });
    sizeBytes += Buffer.byteLength(data.html);
  }

  if (data.attachments?.length) {
    for (const attachment of data.attachments) {
      const attachmentId = randomUUID();
      const safeFilename = sanitizeFilename(attachment.filename);
      const key = `${keyPrefix}/attachments/${attachmentId}-${safeFilename}`;
      const buffer = Buffer.from(attachment.contentBase64, "base64");

      await putObject({
        key,
        body: buffer,
        contentType: attachment.contentType ?? undefined
      });

      await db.query(
        `INSERT INTO attachments (id, message_id, filename, content_type, size_bytes, r2_key)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          attachmentId,
          messageId,
          attachment.filename,
          attachment.contentType ?? null,
          buffer.length,
          key
        ]
      );
    }
  }

  await db.query(
    `UPDATE messages
     SET r2_key_text = $1, r2_key_html = $2, size_bytes = $3
     WHERE id = $4`,
    [textKey, htmlKey, sizeBytes || null, messageId]
  );

  await enqueueEmailOutboxEvent({
    messageRecordId: messageId,
    from: fromEmail,
    to: toList,
    cc: ccList,
    bcc: bccList,
    subject: data.subject,
    replyTo: data.replyTo ?? null
  }, user.tenant_id);

  await recordModuleUsageEvent({
    moduleKey: "email",
    usageKind: "direct_send",
    actorType: "human",
    metadata: {
      route: "/api/email/send",
      messageId,
      mailboxId: mailbox.id,
      toCount: toList.length
    }
  });

  return Response.json({ status: "queued", id: messageId, messageId: outboundMessageId });
}
