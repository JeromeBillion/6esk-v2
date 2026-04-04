import { randomUUID } from "crypto";
import { outboundEmailSchema } from "@/server/email/schema";
import { normalizeAddressList, sanitizeFilename } from "@/server/email/normalize";
import { findMailbox, getOrCreateMailbox } from "@/server/email/mailbox";
import { db } from "@/server/db";
import { putObject } from "@/server/storage/r2";
import { getSessionUser } from "@/server/auth/session";
import { canManageTickets, isLeadAdmin } from "@/server/auth/roles";
import { hasMailboxAccess } from "@/server/messages";
import { isWorkspaceModuleEnabled } from "@/server/workspace-modules";
import { recordModuleUsageEvent } from "@/server/module-metering";

type ResendResponse = {
  id?: string;
  messageId?: string;
};

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
  if (!(await isWorkspaceModuleEnabled("email"))) {
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

  const inReplyTo = data.inReplyTo?.trim() || null;
  const references = normalizeReferenceList([
    ...(data.references ?? []),
    ...(inReplyTo ? [inReplyTo] : [])
  ]);
  const outboundMessageId = buildOutboundMessageId(fromEmail);

  const resendPayload = {
    from: data.from,
    to: toList,
    cc: ccList.length ? ccList : undefined,
    bcc: bccList.length ? bccList : undefined,
    subject: data.subject,
    html: data.html ?? undefined,
    text: data.text ?? undefined,
    reply_to: data.replyTo ?? undefined,
    headers: {
      "Message-ID": outboundMessageId,
      ...(inReplyTo
        ? {
            "In-Reply-To": inReplyTo
          }
        : {}),
      ...(references.length
        ? {
            References: references.join(" ")
          }
        : {})
    },
    attachments: data.attachments?.map((attachment) => ({
      filename: attachment.filename,
      content: attachment.contentBase64,
      contentType: attachment.contentType ?? undefined
    }))
  };

  const resendResponse = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY ?? ""}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(resendPayload)
  });

  if (!resendResponse.ok) {
    const errorBody = await resendResponse.text();
    return Response.json(
      { error: "Resend request failed", details: errorBody },
      { status: 502 }
    );
  }

  const resendData = (await resendResponse.json()) as ResendResponse;
  const messageId = randomUUID();
  const sentAt = new Date();
  const providerMessageId = resendData.id ?? resendData.messageId ?? null;
  const threadId =
    data.threadId?.trim() ||
    references[0] ||
    outboundMessageId;

  await db.query(
    `INSERT INTO messages (
      id, mailbox_id, direction, message_id, thread_id, in_reply_to, reference_ids, external_message_id, provider, from_email,
      to_emails, cc_emails, bcc_emails, subject, preview_text, sent_at, is_read
    ) VALUES (
      $1, $2, 'outbound', $3, $4, $5, $6, $7, 'resend', $8,
      $9, $10, $11, $12, $13, $14, true
    )`,
    [
      messageId,
      mailbox.id,
      outboundMessageId,
      threadId,
      inReplyTo,
      references.length ? references : null,
      providerMessageId,
      fromEmail,
      toList,
      ccList,
      bccList,
      data.subject,
      (data.text ?? "").replace(/\s+/g, " ").trim().slice(0, 200) || null,
      sentAt
    ]
  );

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

  return Response.json({ status: "sent", id: messageId, providerId: providerMessageId, messageId: outboundMessageId });
}
