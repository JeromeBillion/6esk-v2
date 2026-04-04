import type { ApiMailboxMessage, ApiMessageDetail } from "@/app/lib/api/mail";

export type MailView = "inbox" | "starred" | "sent" | "outbox" | "spam";

export type MailThread = {
  id: string;
  subject: string;
  participants: string[];
  message_count: number;
  last_message_at: string;
  unread: boolean;
  starred: boolean;
  hasInbound: boolean;
  hasOutbound: boolean;
  hasSentOutbound: boolean;
  hasQueuedOutbound: boolean;
  hasSpam: boolean;
  messages: ApiMailboxMessage[];
};

function toTitleCase(value: string) {
  return value
    .replace(/[._-]+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function deriveNameFromEmail(value: string) {
  return toTitleCase(value.split("@")[0] ?? value);
}

export function buildMailThreads(messages: ApiMailboxMessage[]) {
  const grouped = new Map<string, ApiMailboxMessage[]>();
  for (const message of messages) {
    const key = message.thread_id ?? message.id;
    const list = grouped.get(key);
    if (list) {
      list.push(message);
    } else {
      grouped.set(key, [message]);
    }
  }

  return Array.from(grouped.entries())
    .map(([id, threadMessages]) => {
      const sorted = [...threadMessages].sort(
        (left, right) =>
          new Date(left.sent_at ?? left.received_at ?? left.created_at).getTime() -
          new Date(right.sent_at ?? right.received_at ?? right.created_at).getTime()
      );
      const last = sorted[sorted.length - 1]!;
      return {
        id,
        subject: last.subject ?? "(no subject)",
        participants: Array.from(new Set(sorted.map((message) => deriveNameFromEmail(message.from_email)))),
        message_count: sorted.length,
        last_message_at: last.sent_at ?? last.received_at ?? last.created_at,
        unread: sorted.some((message) => message.direction === "inbound" && !message.is_read),
        starred: sorted.some((message) => message.is_starred),
        hasInbound: sorted.some((message) => message.direction === "inbound"),
        hasOutbound: sorted.some((message) => message.direction === "outbound"),
        hasSentOutbound: sorted.some((message) => message.direction === "outbound" && Boolean(message.sent_at)),
        hasQueuedOutbound: sorted.some((message) => message.direction === "outbound" && !message.sent_at),
        hasSpam: sorted.some((message) => message.is_spam),
        messages: sorted
      } satisfies MailThread;
    })
    .sort((left, right) => new Date(right.last_message_at).getTime() - new Date(left.last_message_at).getTime());
}

export function filterMailThreads(threads: MailThread[], view: MailView, searchQuery: string) {
  const query = searchQuery.trim().toLowerCase();
  return threads.filter((thread) => {
    const matchesView =
      (view === "inbox" && thread.hasInbound && !thread.hasSpam) ||
      (view === "starred" && thread.starred && !thread.hasSpam) ||
      (view === "sent" && thread.hasSentOutbound && !thread.hasSpam) ||
      (view === "outbox" && thread.hasQueuedOutbound && !thread.hasSpam) ||
      (view === "spam" && thread.hasSpam);

    const matchesSearch =
      !query ||
      thread.subject.toLowerCase().includes(query) ||
      thread.participants.some((participant) => participant.toLowerCase().includes(query)) ||
      thread.messages.some(
        (message) =>
          message.from_email.toLowerCase().includes(query) ||
          message.to_emails.some((email) => email.toLowerCase().includes(query))
      );

    return matchesView && matchesSearch;
  });
}

export function getThreadCorrespondent(thread: MailThread, ownAddress?: string | null) {
  const own = ownAddress?.toLowerCase().trim() ?? null;
  const messagesNewestFirst = [...thread.messages].reverse();

  for (const message of messagesNewestFirst) {
    if (message.direction === "inbound") {
      return deriveNameFromEmail(message.from_email);
    }

    const recipients = message.to_emails.filter((email) => email.toLowerCase() !== own);
    const recipient = recipients[0] ?? message.to_emails[0] ?? null;
    if (recipient) {
      return deriveNameFromEmail(recipient);
    }
  }

  return deriveNameFromEmail(messagesNewestFirst[0]?.from_email ?? thread.participants[0] ?? "Unknown");
}

export function getReplyTargetEmail(
  message: ApiMailboxMessage,
  detail: ApiMessageDetail["message"] | undefined,
  ownAddress?: string | null
) {
  if (message.direction === "inbound") {
    return message.from_email;
  }

  const own = ownAddress?.toLowerCase().trim() ?? null;
  const recipientPool = detail?.to?.length ? detail.to : message.to_emails;
  const externalRecipient =
    recipientPool.find((email) => email.toLowerCase().trim() !== own) ?? recipientPool[0] ?? null;

  return externalRecipient ?? message.from_email;
}
