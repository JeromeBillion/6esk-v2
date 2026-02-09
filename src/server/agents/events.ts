import { randomUUID } from "crypto";
import { getEnv } from "@/server/env";

type Actor = {
  type: "system" | "user";
  id?: string | null;
};

export type AgentEventPayload = {
  event_id: string;
  event_type: string;
  occurred_at: string;
  org_id: string;
  resource: {
    ticket_id?: string | null;
    message_id?: string | null;
    mailbox_id?: string | null;
  };
  actor: Actor;
  conversation_ref?: string | null;
  excerpt?: string | null;
  pointers?: Record<string, string>;
};

const ORG_ID = "6ex-support";

export function buildAgentEvent({
  eventType,
  ticketId,
  messageId,
  mailboxId,
  actorUserId,
  excerpt,
  threadId
}: {
  eventType: string;
  ticketId?: string | null;
  messageId?: string | null;
  mailboxId?: string | null;
  actorUserId?: string | null;
  excerpt?: string | null;
  threadId?: string | null;
}) {
  const env = getEnv();
  const pointers: Record<string, string> = {};

  if (ticketId) {
    pointers.ticket = `${env.APP_URL}/api/agent/v1/tickets/${ticketId}`;
    pointers.messages = `${env.APP_URL}/api/agent/v1/tickets/${ticketId}/messages`;
  }

  if (threadId) {
    pointers.thread = `${env.APP_URL}/api/agent/v1/threads/${threadId}`;
  }

  return {
    event_id: randomUUID(),
    event_type: eventType,
    occurred_at: new Date().toISOString(),
    org_id: ORG_ID,
    resource: {
      ticket_id: ticketId ?? null,
      message_id: messageId ?? null,
      mailbox_id: mailboxId ?? null
    },
    actor: actorUserId ? { type: "user", id: actorUserId } : { type: "system" },
    conversation_ref: ticketId ?? threadId ?? null,
    excerpt: excerpt ?? null,
    pointers: Object.keys(pointers).length ? pointers : undefined
  } satisfies AgentEventPayload;
}
