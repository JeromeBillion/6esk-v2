import { apiFetch } from "@/app/lib/api/http";

export type ApiMailbox = {
  id: string;
  address: string;
  type: string;
};

export type ApiMailboxMessage = {
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
  spam_reason?: string | null;
  thread_id: string | null;
  message_id?: string | null;
  created_at: string;
  has_attachments: boolean;
};

export type ApiMessageDetail = {
  message: {
    id: string;
    messageId?: string | null;
    threadId?: string | null;
    inReplyTo?: string | null;
    references?: string[];
    from: string;
    to: string[];
    direction: "inbound" | "outbound";
    subject: string | null;
    sentAt: string | null;
    receivedAt: string | null;
    isStarred?: boolean;
    isPinned?: boolean;
    isSpam?: boolean;
    spamReason?: string | null;
    text: string | null;
    html: string | null;
  };
  attachments: Array<{
    id: string;
    filename: string;
    content_type: string | null;
    size_bytes: number | null;
  }>;
};

export async function listMailboxes() {
  const payload = await apiFetch<{ mailboxes: ApiMailbox[] }>("/api/mailboxes");
  return payload.mailboxes ?? [];
}

export async function listMailboxMessages(mailboxId: string, signal?: AbortSignal) {
  const payload = await apiFetch<{ messages: ApiMailboxMessage[] }>(`/api/mailboxes/${mailboxId}/messages`, {
    signal
  });
  return payload.messages ?? [];
}

export function getMailMessageDetail(messageId: string) {
  return apiFetch<ApiMessageDetail>(`/api/messages/${messageId}`);
}

export function patchThreadStar(messageId: string, isStarred: boolean) {
  return apiFetch<{ updatedIds: string[] }>(`/api/messages/${messageId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ isStarred })
  });
}

export function patchThreadPin(messageId: string, isPinned: boolean) {
  return apiFetch<{ updatedIds: string[] }>(`/api/messages/${messageId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ isPinned })
  });
}

export function patchThreadRead(messageId: string, isRead: boolean) {
  return apiFetch<{ updatedIds: string[] }>(`/api/messages/${messageId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ isRead })
  });
}

export function sendMail(input: {
  from: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  text?: string;
  html?: string;
  replyTo?: string;
  threadId?: string;
  inReplyTo?: string;
  references?: string[];
  attachments?: Array<{
    filename: string;
    contentType?: string | null;
    contentBase64: string;
  }>;
}) {
  return apiFetch<{ status: string; messageId?: string }>("/api/email/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
}

export function patchMessageSpam(messageId: string, isSpam: boolean, reason?: string | null) {
  return apiFetch<{ status: string; message: { id: string; is_spam: boolean; spam_reason: string | null } }>(
    `/api/messages/${messageId}/spam`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isSpam, reason: reason ?? null })
    }
  );
}
