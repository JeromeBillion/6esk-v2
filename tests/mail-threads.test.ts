import { describe, expect, it } from "vitest";
import {
  buildMailThreads,
  filterMailThreads,
  getReplyTargetEmail
} from "@/app/lib/mail-threads";
import type { ApiMailboxMessage } from "@/app/lib/api/mail";

function buildMessage(overrides?: Partial<ApiMailboxMessage>): ApiMailboxMessage {
  return {
    id: "msg-1",
    direction: "inbound",
    channel: "email",
    from_email: "customer@example.com",
    to_emails: ["jerome.choma@6ex.co.za"],
    subject: "Need help",
    preview_text: "Preview",
    received_at: "2026-04-03T10:00:00.000Z",
    sent_at: null,
    is_read: false,
    is_starred: false,
    is_pinned: false,
    is_spam: false,
    spam_reason: null,
    thread_id: "thread-1",
    message_id: "<message-1@example.com>",
    created_at: "2026-04-03T10:00:00.000Z",
    has_attachments: false,
    ...overrides
  };
}

describe("mail thread filtering", () => {
  it("keeps sent outbound-only threads out of Inbox and places them in Sent", () => {
    const inboundThread = buildMessage();
    const outboundOnlyThread = buildMessage({
      id: "msg-2",
      direction: "outbound",
      from_email: "jerome.choma@6ex.co.za",
      to_emails: ["customer@example.com"],
      received_at: null,
      sent_at: "2026-04-03T11:00:00.000Z",
      is_read: true,
      thread_id: "thread-2",
      message_id: "<message-2@6ex.co.za>"
    });

    const threads = buildMailThreads([inboundThread, outboundOnlyThread]);

    expect(filterMailThreads(threads, "inbox", "").map((thread) => thread.id)).toEqual(["thread-1"]);
    expect(filterMailThreads(threads, "outbox", "")).toHaveLength(0);
    expect(filterMailThreads(threads, "sent", "").map((thread) => thread.id)).toEqual(["thread-2"]);
  });

  it("shows queued outbound-only threads in Outbox until they have a sent timestamp", () => {
    const queued = buildMessage({
      id: "msg-pending",
      direction: "outbound",
      from_email: "jerome.choma@6ex.co.za",
      to_emails: ["customer@example.com"],
      received_at: null,
      sent_at: null,
      is_read: true,
      thread_id: "thread-pending",
      message_id: "<pending@6ex.co.za>"
    });

    const threads = buildMailThreads([queued]);

    expect(filterMailThreads(threads, "outbox", "").map((thread) => thread.id)).toEqual(["thread-pending"]);
    expect(filterMailThreads(threads, "sent", "")).toHaveLength(0);
    expect(filterMailThreads(threads, "inbox", "")).toHaveLength(0);
  });

  it("keeps replied conversations in Inbox while retaining them in Sent", () => {
    const outbound = buildMessage({
      id: "msg-3",
      direction: "outbound",
      from_email: "jerome.choma@6ex.co.za",
      to_emails: ["customer@example.com"],
      received_at: null,
      sent_at: "2026-04-03T11:00:00.000Z",
      is_read: true,
      thread_id: "<root@6ex.co.za>",
      message_id: "<root@6ex.co.za>"
    });
    const reply = buildMessage({
      id: "msg-4",
      thread_id: "<root@6ex.co.za>",
      message_id: "<reply@example.com>",
      received_at: "2026-04-03T11:30:00.000Z",
      sent_at: null
    });

    const threads = buildMailThreads([outbound, reply]);

    expect(filterMailThreads(threads, "inbox", "").map((thread) => thread.id)).toEqual(["<root@6ex.co.za>"]);
    expect(filterMailThreads(threads, "outbox", "")).toHaveLength(0);
    expect(filterMailThreads(threads, "sent", "").map((thread) => thread.id)).toEqual(["<root@6ex.co.za>"]);
  });
});

describe("mail reply targeting", () => {
  it("replies to the external recipient when the selected message was outbound", () => {
    const outbound = buildMessage({
      id: "msg-5",
      direction: "outbound",
      from_email: "jerome.choma@6ex.co.za",
      to_emails: ["choma98logical@gmail.com"],
      received_at: null,
      sent_at: "2026-04-03T12:00:00.000Z",
      is_read: true
    });

    expect(
      getReplyTargetEmail(
        outbound,
        {
          id: outbound.id,
          from: outbound.from_email,
          to: outbound.to_emails,
          direction: "outbound",
          subject: outbound.subject,
          sentAt: outbound.sent_at,
          receivedAt: outbound.received_at,
          text: null,
          html: null
        },
        "jerome.choma@6ex.co.za"
      )
    ).toBe("choma98logical@gmail.com");
  });
});
