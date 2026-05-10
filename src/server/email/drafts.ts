import { randomUUID } from "crypto";
import { db } from "@/server/db";
import { deleteObject, putObject } from "@/server/storage/r2";
import { normalizeAddressList } from "@/server/email/normalize";
import { getMessageById, type MessageRecord } from "@/server/messages";

type UpsertMailDraftArgs = {
  draftId?: string | null;
  tenantId: string;
  mailboxId: string;
  fromEmail: string;
  to?: string[] | null;
  cc?: string[] | null;
  bcc?: string[] | null;
  subject?: string | null;
  text?: string | null;
  html?: string | null;
  threadId?: string | null;
  inReplyTo?: string | null;
  references?: string[] | null;
};

type MailboxMessageSummary = {
  id: string;
  direction: "inbound" | "outbound";
  channel: "email" | "whatsapp" | "voice";
  from_email: string;
  to_emails: string[];
  subject: string | null;
  preview_text: string | null;
  received_at: string | null;
  sent_at: string | null;
  is_read: boolean;
  is_starred: boolean;
  is_pinned: boolean;
  is_spam: boolean;
  spam_reason: string | null;
  thread_id: string | null;
  message_id: string | null;
  created_at: string;
  has_attachments: boolean;
  mail_state: string | null;
  sort_at: string | null;
};

function stripHtml(value: string) {
  return value
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildPreview(text?: string | null, html?: string | null) {
  const source = (text?.trim() || stripHtml(html ?? "")).replace(/\s+/g, " ").trim();
  return source ? source.slice(0, 200) : null;
}

function buildDraftMetadata(existing: Record<string, unknown> | null) {
  return {
    ...(existing ?? {}),
    mail_state: "draft",
    draft_saved_at: new Date().toISOString()
  };
}

export function isMailDraftRecord(message: Pick<MessageRecord, "direction" | "sent_at" | "metadata">) {
  return message.direction === "outbound" && message.sent_at === null && message.metadata?.mail_state === "draft";
}

async function persistDraftBodies(draftId: string, tenantId: string, text?: string | null, html?: string | null) {
  const existing = await getMessageById(draftId, tenantId);
  const keyPrefix = `messages/${draftId}`;
  let textKey: string | null = null;
  let htmlKey: string | null = null;
  let sizeBytes = 0;

  if (text?.trim()) {
    textKey = await putObject({
      key: `${keyPrefix}/body.txt`,
      body: text,
      contentType: "text/plain; charset=utf-8"
    });
    sizeBytes += Buffer.byteLength(text);
  }

  if (html?.trim()) {
    htmlKey = await putObject({
      key: `${keyPrefix}/body.html`,
      body: html,
      contentType: "text/html; charset=utf-8"
    });
    sizeBytes += Buffer.byteLength(html);
  }

  await db.query(
    `UPDATE messages
     SET r2_key_text = $1,
         r2_key_html = $2,
         size_bytes = $3
     WHERE id = $4
       AND tenant_id = $5`,
    [textKey, htmlKey, sizeBytes || null, draftId, tenantId]
  );

  const keysToDelete = [
    !textKey ? existing?.r2_key_text ?? null : null,
    !htmlKey ? existing?.r2_key_html ?? null : null
  ].filter((value): value is string => Boolean(value));

  await Promise.all(
    keysToDelete.map(async (key) => {
      try {
        await deleteObject(key);
      } catch (error) {
        // Best-effort cleanup for cleared draft bodies.
        console.error("[Drafts] Failed to delete R2 object:", key, error instanceof Error ? error.message : error);
      }
    })
  );
}

export async function getMailboxMessageSummaryById(messageId: string, tenantId: string) {
  const result = await db.query<MailboxMessageSummary>(
    `SELECT m.id, m.direction, m.channel, m.from_email, m.to_emails, m.subject, m.preview_text, m.received_at, m.sent_at,
            m.is_read, m.is_starred, m.is_pinned, m.is_spam, m.spam_reason, m.thread_id, m.message_id, m.created_at,
            EXISTS (SELECT 1 FROM attachments a WHERE a.message_id = m.id AND a.tenant_id = m.tenant_id) AS has_attachments,
            COALESCE(
              m.metadata->>'mail_state',
              CASE
                WHEN m.direction = 'outbound' AND m.sent_at IS NULL THEN 'queued'
                WHEN m.direction = 'outbound' THEN 'sent'
                ELSE 'received'
              END
            ) AS mail_state,
            COALESCE(
              m.received_at,
              m.sent_at,
              NULLIF(m.metadata->>'draft_saved_at', '')::timestamptz,
              m.created_at
            ) AS sort_at
     FROM messages m
     WHERE m.id = $1
       AND m.tenant_id = $2
     LIMIT 1`,
    [messageId, tenantId]
  );

  return result.rows[0] ?? null;
}

export async function upsertMailDraft({
  draftId,
  tenantId,
  mailboxId,
  fromEmail,
  to,
  cc,
  bcc,
  subject,
  text,
  html,
  threadId,
  inReplyTo,
  references
}: UpsertMailDraftArgs) {
  const toList = normalizeAddressList(to ?? []);
  const ccList = normalizeAddressList(cc ?? []);
  const bccList = normalizeAddressList(bcc ?? []);
  const referenceIds = Array.from(new Set((references ?? []).map((value) => value.trim()).filter(Boolean)));
  const previewText = buildPreview(text, html);

  let resolvedDraftId = draftId ?? randomUUID();
  if (draftId) {
    const existing = await getMessageById(draftId, tenantId);
    if (!existing || existing.mailbox_id !== mailboxId || !isMailDraftRecord(existing)) {
      throw new Error("Draft not found");
    }

    await db.query(
      `UPDATE messages
       SET thread_id = $1,
           in_reply_to = $2,
           reference_ids = $3,
           provider = 'draft',
           from_email = $4,
           to_emails = $5,
           cc_emails = $6,
           bcc_emails = $7,
           subject = $8,
           preview_text = $9,
           is_read = true,
           metadata = $10::jsonb
       WHERE id = $11
         AND tenant_id = $12`,
      [
        threadId?.trim() || null,
        inReplyTo?.trim() || null,
        referenceIds.length ? referenceIds : null,
        fromEmail,
        toList,
        ccList,
        bccList,
        subject?.trim() || null,
        previewText,
        buildDraftMetadata(existing.metadata ?? null),
        draftId,
        tenantId
      ]
    );
  } else {
    await db.query(
      `INSERT INTO messages (
        tenant_id, id, mailbox_id, direction, channel, thread_id, in_reply_to, reference_ids, provider,
        from_email, to_emails, cc_emails, bcc_emails, subject, preview_text, is_read, metadata
      ) VALUES (
        $1, $2, $3, 'outbound', 'email', $4, $5, $6, 'draft',
        $7, $8, $9, $10, $11, $12, true, $13::jsonb
      )`,
      [
        tenantId,
        resolvedDraftId,
        mailboxId,
        threadId?.trim() || null,
        inReplyTo?.trim() || null,
        referenceIds.length ? referenceIds : null,
        fromEmail,
        toList,
        ccList,
        bccList,
        subject?.trim() || null,
        previewText,
        buildDraftMetadata(null)
      ]
    );
  }

  await persistDraftBodies(resolvedDraftId, tenantId, text, html);
  return getMailboxMessageSummaryById(resolvedDraftId, tenantId);
}

export async function deleteMailDraft(draftId: string, tenantId: string, mailboxId?: string | null) {
  const existing = await getMessageById(draftId, tenantId);
  if (!existing || !isMailDraftRecord(existing) || (mailboxId && existing.mailbox_id !== mailboxId)) {
    return false;
  }

  const attachmentResult = await db.query<{ r2_key: string | null }>(
    `SELECT r2_key
     FROM attachments
     WHERE message_id = $1
       AND tenant_id = $2`,
    [draftId, tenantId]
  );

  await db.query(`DELETE FROM messages WHERE id = $1 AND tenant_id = $2`, [draftId, tenantId]);

  const keys = [
    existing.r2_key_raw,
    existing.r2_key_text,
    existing.r2_key_html,
    ...attachmentResult.rows.map((row) => row.r2_key)
  ].filter((value): value is string => Boolean(value));

  await Promise.all(
    keys.map(async (key) => {
      try {
        await deleteObject(key);
      } catch (error) {
        // Best-effort cleanup; the draft row is already gone.
        console.error("[Drafts] Failed to delete R2 object:", key, error instanceof Error ? error.message : error);
      }
    })
  );

  return true;
}
