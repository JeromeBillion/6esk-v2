import { randomUUID } from "crypto";
import { outboundEmailSchema } from "@/server/email/schema";
import { normalizeAddressList, sanitizeFilename } from "@/server/email/normalize";
import { getOrCreateMailbox } from "@/server/email/mailbox";
import { db } from "@/server/db";
import { putObject } from "@/server/storage/r2";

type ResendResponse = {
  id?: string;
  messageId?: string;
};

function getSupportAddress() {
  const explicit = process.env.SUPPORT_ADDRESS;
  if (explicit) {
    return explicit.toLowerCase();
  }
  const domain = process.env.RESEND_FROM_DOMAIN ?? "";
  return domain ? `support@${domain}`.toLowerCase() : "";
}

export async function POST(request: Request) {
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
  const mailbox = await getOrCreateMailbox(fromEmail, supportAddress);

  const resendPayload = {
    from: data.from,
    to: toList,
    cc: ccList.length ? ccList : undefined,
    bcc: bccList.length ? bccList : undefined,
    subject: data.subject,
    html: data.html ?? undefined,
    text: data.text ?? undefined,
    reply_to: data.replyTo ?? undefined,
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

  await db.query(
    `INSERT INTO messages (
      id, mailbox_id, direction, message_id, thread_id, from_email,
      to_emails, cc_emails, bcc_emails, subject, preview_text, sent_at, is_read
    ) VALUES (
      $1, $2, 'outbound', $3, $4, $5,
      $6, $7, $8, $9, $10, $11, true
    )`,
    [
      messageId,
      mailbox.id,
      resendData.messageId ?? resendData.id ?? null,
      resendData.messageId ?? resendData.id ?? messageId,
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

  return Response.json({ status: "sent", id: messageId, providerId: resendData.id });
}
