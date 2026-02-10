"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import AppShell from "@/app/components/AppShell";

type Mailbox = {
  id: string;
  address: string;
  type: "platform" | "personal";
};

type Message = {
  id: string;
  direction: "inbound" | "outbound";
  from_email: string;
  subject: string | null;
  preview_text: string | null;
  received_at: string | null;
  sent_at: string | null;
  is_read: boolean;
  thread_id: string | null;
  message_id: string | null;
  created_at: string;
};

type MessageDetail = {
  id: string;
  subject: string | null;
  from: string;
  to: string[];
  direction: "inbound" | "outbound";
  origin: "human" | "ai";
  receivedAt: string | null;
  sentAt: string | null;
  text: string | null;
  html: string | null;
};

type Attachment = {
  id: string;
  filename: string;
  content_type: string | null;
  size_bytes: number | null;
};

type Folder = "inbox" | "starred" | "sent" | "drafts";

export default function MailClient() {
  const [mailboxes, setMailboxes] = useState<Mailbox[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [activeMailbox, setActiveMailbox] = useState<string | null>(null);
  const [folder, setFolder] = useState<Folder>("inbox");
  const [activeMessageId, setActiveMessageId] = useState<string | null>(null);
  const [messageDetail, setMessageDetail] = useState<MessageDetail | null>(null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [loadingMessage, setLoadingMessage] = useState(false);
  const [threadsExpanded, setThreadsExpanded] = useState<Record<string, boolean>>({});
  const [composeMode, setComposeMode] = useState<"reply" | "forward" | "new" | null>(null);
  const [composeTo, setComposeTo] = useState("");
  const [composeSubject, setComposeSubject] = useState("");
  const [composeBody, setComposeBody] = useState("");
  const [composeStatus, setComposeStatus] = useState<"idle" | "sending" | "sent" | "error">(
    "idle"
  );
  const [composeError, setComposeError] = useState<string | null>(null);

  useEffect(() => {
    async function loadMailboxes() {
      const res = await fetch("/api/mailboxes");
      if (!res.ok) {
        return;
      }
      const payload = await res.json();
      const list = payload.mailboxes ?? [];
      setMailboxes(list);
      const personal = list.find((item: Mailbox) => item.type === "personal") ?? null;
      setActiveMailbox(personal?.id ?? null);
    }

    void loadMailboxes();
  }, []);

  useEffect(() => {
    setActiveMessageId(null);
    setMessageDetail(null);
    setAttachments([]);
    setThreadsExpanded({});
    resetComposer();
  }, [folder]);

  function getPlainText(detail: MessageDetail) {
    if (detail.text) return detail.text;
    if (detail.html) {
      return detail.html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    }
    return "";
  }

  function resetComposer() {
    setComposeMode(null);
    setComposeTo("");
    setComposeSubject("");
    setComposeBody("");
    setComposeStatus("idle");
    setComposeError(null);
  }

  function startComposeNew() {
    setComposeMode("new");
    setComposeTo("");
    setComposeSubject("");
    setComposeBody("");
    setComposeStatus("idle");
    setComposeError(null);
    setActiveMessageId(null);
    setMessageDetail(null);
    setAttachments([]);
  }

  function prefillReply(detail: MessageDetail) {
    const subject = detail.subject ?? "";
    const replySubject = subject.toLowerCase().startsWith("re:") ? subject : `Re: ${subject}`.trim();
    const to = detail.direction === "inbound" ? detail.from : detail.to[0] ?? "";

    setComposeMode("reply");
    setComposeTo(to);
    setComposeSubject(replySubject || "Re:");
    setComposeBody("");
    setComposeStatus("idle");
    setComposeError(null);
  }

  function prefillForward(detail: MessageDetail) {
    const subject = detail.subject ?? "";
    const forwardSubject = subject.toLowerCase().startsWith("fwd:") ? subject : `Fwd: ${subject}`.trim();
    const quoted = getPlainText(detail);
    const header = [
      "--- Forwarded message ---",
      `From: ${detail.from}`,
      `To: ${detail.to.join(", ")}`,
      `Subject: ${detail.subject ?? "(no subject)"}`,
      ""
    ].join("\n");

    setComposeMode("forward");
    setComposeTo("");
    setComposeSubject(forwardSubject || "Fwd:");
    setComposeBody(quoted ? `${header}\n${quoted}` : header);
    setComposeStatus("idle");
    setComposeError(null);
  }

  function getMessageTimestamp(message: Message) {
    const value = message.received_at ?? message.sent_at ?? message.created_at;
    return value ? new Date(value).getTime() : 0;
  }

  const threadGroups = useMemo(() => {
    const filteredMessages = messages.filter((message) => {
      if (folder === "inbox") return message.direction === "inbound";
      if (folder === "sent") return message.direction === "outbound";
      if (folder === "starred") return false;
      if (folder === "drafts") return false;
      return true;
    });

    const map = new Map<string, Message[]>();
    for (const message of filteredMessages) {
      const key = message.thread_id ?? message.id;
      const group = map.get(key);
      if (group) {
        group.push(message);
      } else {
        map.set(key, [message]);
      }
    }

    const groups = Array.from(map.entries()).map(([threadId, threadMessages]) => {
      const sortedByRecent = [...threadMessages].sort(
        (a, b) => getMessageTimestamp(b) - getMessageTimestamp(a)
      );
      const sortedByOldest = [...threadMessages].sort(
        (a, b) => getMessageTimestamp(a) - getMessageTimestamp(b)
      );
      return {
        id: threadId,
        messages: sortedByOldest,
        latest: sortedByRecent[0],
        count: threadMessages.length,
        lastActivity: getMessageTimestamp(sortedByRecent[0])
      };
    });

    groups.sort((a, b) => b.lastActivity - a.lastActivity);
    return groups;
  }, [messages, folder]);

  useEffect(() => {
    async function loadMessages() {
      if (!activeMailbox) {
        setMessages([]);
        setActiveMessageId(null);
        setMessageDetail(null);
        setAttachments([]);
        setThreadsExpanded({});
        resetComposer();
        return;
      }
      const res = await fetch(`/api/mailboxes/${activeMailbox}/messages`);
      if (!res.ok) {
        return;
      }
      const payload = await res.json();
      setMessages(payload.messages ?? []);
      setActiveMessageId(null);
      setMessageDetail(null);
      setAttachments([]);
      setThreadsExpanded({});
      resetComposer();
    }

    void loadMessages();
  }, [activeMailbox]);

  async function loadMessageDetail(messageId: string, threadId?: string | null) {
    setLoadingMessage(true);
    setActiveMessageId(messageId);
    if (threadId) {
      setThreadsExpanded((prev) => ({ ...prev, [threadId]: true }));
    }
    const res = await fetch(`/api/messages/${messageId}`);
    if (res.ok) {
      const payload = await res.json();
      setMessageDetail(payload.message ?? null);
      setAttachments(payload.attachments ?? []);
      resetComposer();
    }
    setLoadingMessage(false);
  }

  async function sendEmail() {
    if (!activeMailbox) return;
    const mailbox = mailboxes.find((item) => item.id === activeMailbox);
    if (!mailbox) return;

    const toList = composeTo
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);

    if (toList.length === 0) {
      setComposeError("Recipient email required.");
      setComposeStatus("error");
      return;
    }
    if (!composeSubject.trim()) {
      setComposeError("Subject required.");
      setComposeStatus("error");
      return;
    }
    if (!composeBody.trim()) {
      setComposeError("Message body required.");
      setComposeStatus("error");
      return;
    }

    setComposeStatus("sending");
    setComposeError(null);
    const res = await fetch("/api/email/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        from: mailbox.address,
        to: toList,
        subject: composeSubject,
        text: composeBody
      })
    });

    if (!res.ok) {
      const payload = await res.json().catch(() => ({}));
      setComposeError(payload.error ?? "Failed to send email");
      setComposeStatus("error");
      return;
    }

    setComposeStatus("sent");
    setComposeMode(null);
    setComposeBody("");
    setComposeTo("");
    setComposeSubject("");
    if (activeMessageId) {
      await loadMessageDetail(activeMessageId);
    }
  }

  const activeMailboxRecord = mailboxes.find((item) => item.id === activeMailbox) ?? null;
  const inboxCount = messages.filter((message) => message.direction === "inbound").length;
  const sentCount = messages.filter((message) => message.direction === "outbound").length;
  const draftsCount = 0;
  const starredCount = 0;

  const folderLabel =
    folder === "inbox"
      ? "Inbox"
      : folder === "sent"
        ? "Sent"
        : folder === "starred"
          ? "Starred"
          : "Drafts";

  const composeTitle =
    composeMode === "reply"
      ? "Reply"
      : composeMode === "forward"
        ? "Forward"
        : "New message";

  return (
    <AppShell
      title="Personal Mail"
      subtitle={activeMailboxRecord ? activeMailboxRecord.address : "No personal mailbox assigned."}
    >
      <div className="app-content">
        {!activeMailboxRecord ? (
          <div className="panel">
            <h2>No personal mailbox yet</h2>
            <p>Ask a Lead Admin to provision your personal mailbox address.</p>
          </div>
        ) : (
          <div className="mail-layout">
            <aside className="panel mail-sidebar">
              <button type="button" onClick={startComposeNew} className="mail-compose">
                <span aria-hidden>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                    <path
                      d="M4 20h4l10-10-4-4L4 16v4z"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    <path
                      d="M14 6l4 4"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
                Compose
              </button>

              <div className="mail-folders">
                <button
                  type="button"
                  onClick={() => setFolder("inbox")}
                  className={`mail-folder${folder === "inbox" ? " active" : ""}`}
                >
                  <span className="mail-folder-label">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
                      <path
                        d="M4 7h16v10H4V7z"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                      <path
                        d="M4 7l8 6 8-6"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                    Inbox
                  </span>
                  <span className="mail-count">{inboxCount}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setFolder("starred")}
                  className={`mail-folder${folder === "starred" ? " active" : ""}`}
                >
                  <span className="mail-folder-label">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
                      <path
                        d="M12 4l2.6 5.2 5.7.8-4.1 4 1 5.7L12 17l-5.2 2.7 1-5.7-4.1-4 5.7-.8L12 4z"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                    Starred
                  </span>
                  <span className="mail-count">{starredCount}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setFolder("sent")}
                  className={`mail-folder${folder === "sent" ? " active" : ""}`}
                >
                  <span className="mail-folder-label">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
                      <path
                        d="M4 12h16"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                      <path
                        d="M14 6l6 6-6 6"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                    Sent
                  </span>
                  <span className="mail-count">{sentCount}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setFolder("drafts")}
                  className={`mail-folder${folder === "drafts" ? " active" : ""}`}
                >
                  <span className="mail-folder-label">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
                      <path
                        d="M6 4h9l5 5v11H6V4z"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                      <path
                        d="M14 4v5h5"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                    Drafts
                  </span>
                  <span className="mail-count">{draftsCount}</span>
                </button>
              </div>
            </aside>

            <section style={{ display: "grid", gap: 16 }}>
              <div className="panel">
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                  <div>
                    <h2 style={{ margin: 0 }}>{folderLabel}</h2>
                    <p style={{ marginTop: 6 }}>
                      {folder === "starred" || folder === "drafts"
                        ? "No items here yet."
                        : "Recent conversations from your personal mailbox."}
                    </p>
                  </div>
                </div>
              </div>

              <div style={{ display: "grid", gap: 12 }}>
                {threadGroups.length === 0 ? (
                  <p>No messages yet.</p>
                ) : (
                  threadGroups.map((thread) => {
                    const latest = thread.latest;
                    const timestamp = latest.received_at ?? latest.sent_at ?? latest.created_at ?? "";
                    const expanded = threadsExpanded[thread.id] ?? false;

                    return (
                      <div
                        key={thread.id}
                        style={{
                          border: "1px solid var(--border)",
                          borderRadius: 12,
                          padding: 12,
                          background: "rgba(10, 12, 18, 0.6)"
                        }}
                      >
                        <button
                          type="button"
                          onClick={() =>
                            setThreadsExpanded((prev) => ({
                              ...prev,
                              [thread.id]: !expanded
                            }))
                          }
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            gap: 12,
                            width: "100%",
                            background: "transparent",
                            border: "none",
                            color: "inherit",
                            cursor: "pointer",
                            padding: 0,
                            textAlign: "left"
                          }}
                        >
                          <div>
                            <strong>{latest.subject ?? "(no subject)"}</strong>
                            <p style={{ marginTop: 6 }}>{latest.preview_text ?? ""}</p>
                            <p style={{ fontSize: 12, color: "var(--muted)" }}>
                              {latest.direction === "inbound" ? "From" : "To"}: {latest.from_email}
                            </p>
                          </div>
                          <div style={{ textAlign: "right", fontSize: 12, color: "var(--muted)" }}>
                            <div>{timestamp}</div>
                            <div>{thread.count} msg</div>
                            <div>{expanded ? "Collapse" : "Expand"}</div>
                          </div>
                        </button>

                        {expanded ? (
                          <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
                            {thread.messages.map((message) => {
                              const detailTimestamp =
                                message.received_at ?? message.sent_at ?? message.created_at ?? "";
                              return (
                                <button
                                  key={message.id}
                                  type="button"
                                  onClick={() => loadMessageDetail(message.id, thread.id)}
                                  style={{
                                    border: "1px solid var(--border)",
                                    borderRadius: 10,
                                    padding: 10,
                                    background:
                                      message.id === activeMessageId
                                        ? "rgba(57, 184, 255, 0.15)"
                                        : "rgba(10, 12, 18, 0.6)",
                                    color: "inherit",
                                    textAlign: "left",
                                    cursor: "pointer"
                                  }}
                                >
                                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                                    <strong>{message.subject ?? "(no subject)"}</strong>
                                    <span style={{ fontSize: 12 }}>{detailTimestamp}</span>
                                  </div>
                                  <p style={{ marginTop: 6 }}>{message.preview_text ?? ""}</p>
                                  <p style={{ fontSize: 12, color: "var(--muted)" }}>
                                    {message.direction === "inbound" ? "From" : "To"}: {" "}
                                    {message.from_email}
                                  </p>
                                </button>
                              );
                            })}
                          </div>
                        ) : null}
                      </div>
                    );
                  })
                )}
              </div>

              <div
                style={{
                  border: "1px solid var(--border)",
                  borderRadius: 12,
                  padding: 16,
                  background: "rgba(10, 12, 18, 0.6)"
                }}
              >
                <h2 style={{ marginTop: 0 }}>Message Detail</h2>
                {loadingMessage ? <p>Loading...</p> : null}
                {!messageDetail && composeMode !== "new" ? (
                  <p>Select a message to view the full body.</p>
                ) : null}
                {messageDetail ? (
                  <div style={{ display: "grid", gap: 12 }}>
                    <div style={{ fontSize: 12, color: "var(--muted)" }}>
                      From: {messageDetail.from} · To: {messageDetail.to.join(", ")}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--muted)" }}>
                      {messageDetail.receivedAt ?? messageDetail.sentAt ?? ""}
                    </div>
                    {messageDetail.html ? (
                      <div
                        style={{
                          border: "1px solid var(--border)",
                          borderRadius: 10,
                          padding: 12,
                          background: "rgba(10, 12, 18, 0.6)"
                        }}
                        dangerouslySetInnerHTML={{ __html: messageDetail.html }}
                      />
                    ) : (
                      <pre
                        style={{
                          whiteSpace: "pre-wrap",
                          border: "1px solid var(--border)",
                          borderRadius: 10,
                          padding: 12,
                          background: "rgba(10, 12, 18, 0.6)",
                          margin: 0
                        }}
                      >
                        {messageDetail.text ?? "No message body available."}
                      </pre>
                    )}
                    {attachments.length ? (
                      <div style={{ display: "grid", gap: 12 }}>
                        <strong>Attachments</strong>
                        {attachments.map((attachment) => {
                          const isImage = attachment.content_type?.startsWith("image/");
                          const isPdf = attachment.content_type === "application/pdf";
                          const url = `/api/attachments/${attachment.id}`;
                          return (
                            <div
                              key={attachment.id}
                              style={{
                                border: "1px solid var(--border)",
                                borderRadius: 10,
                                padding: 10,
                                background: "rgba(10, 12, 18, 0.6)"
                              }}
                            >
                              <a href={url} style={{ color: "var(--accent)" }}>
                                {attachment.filename}
                              </a>
                              {isImage ? (
                                <div style={{ marginTop: 8 }}>
                                  <Image
                                    src={url}
                                    alt={attachment.filename}
                                    width={800}
                                    height={600}
                                    unoptimized
                                    style={{
                                      display: "block",
                                      maxWidth: "100%",
                                      height: "auto",
                                      borderRadius: 8
                                    }}
                                  />
                                </div>
                              ) : null}
                              {isPdf ? (
                                <iframe
                                  title={attachment.filename}
                                  src={url}
                                  style={{
                                    width: "100%",
                                    height: 320,
                                    marginTop: 8,
                                    border: "none",
                                    borderRadius: 8
                                  }}
                                />
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    ) : null}

                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <button
                        type="button"
                        onClick={() => prefillReply(messageDetail)}
                        style={{
                          padding: "8px 12px",
                          borderRadius: 8,
                          border: "1px solid var(--border)",
                          background: "var(--surface-2)",
                          color: "var(--text)",
                          cursor: "pointer"
                        }}
                      >
                        Reply
                      </button>
                      <button
                        type="button"
                        onClick={() => prefillForward(messageDetail)}
                        style={{
                          padding: "8px 12px",
                          borderRadius: 8,
                          border: "1px solid var(--border)",
                          background: "transparent",
                          color: "var(--muted)",
                          cursor: "pointer"
                        }}
                      >
                        Forward
                      </button>
                    </div>
                  </div>
                ) : null}

                {composeMode ? (
                  <div style={{ display: "grid", gap: 10, marginTop: 16 }}>
                    <h3 style={{ margin: 0 }}>{composeTitle}</h3>
                    <label>
                      To
                      <input
                        type="text"
                        value={composeTo}
                        onChange={(event) => setComposeTo(event.target.value)}
                        placeholder="recipient@example.com"
                      />
                    </label>
                    <label>
                      Subject
                      <input
                        type="text"
                        value={composeSubject}
                        onChange={(event) => setComposeSubject(event.target.value)}
                      />
                    </label>
                    <label>
                      Message
                      <textarea
                        rows={6}
                        value={composeBody}
                        onChange={(event) => setComposeBody(event.target.value)}
                      />
                    </label>
                    {composeError ? <p style={{ color: "var(--danger)" }}>{composeError}</p> : null}
                    {composeStatus === "sent" ? (
                      <p style={{ color: "var(--accent)" }}>Message sent.</p>
                    ) : null}
                    <div style={{ display: "flex", gap: 8 }}>
                      <button
                        type="button"
                        onClick={sendEmail}
                        disabled={composeStatus === "sending"}
                        style={{
                          padding: "10px 14px",
                          borderRadius: 10,
                          border: "none",
                          background:
                            "linear-gradient(135deg, var(--accent-strong), var(--accent))",
                          color: "#081018",
                          cursor: "pointer"
                        }}
                      >
                        {composeStatus === "sending" ? "Sending..." : "Send"}
                      </button>
                      <button
                        type="button"
                        onClick={resetComposer}
                        style={{
                          padding: "10px 14px",
                          borderRadius: 10,
                          border: "1px solid var(--border)",
                          background: "transparent",
                          color: "var(--muted)",
                          cursor: "pointer"
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            </section>
          </div>
        )}
      </div>
    </AppShell>
  );
}
