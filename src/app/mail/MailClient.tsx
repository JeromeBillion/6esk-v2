"use client";

import { useEffect, useState } from "react";

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
};

export default function MailClient() {
  const [mailboxes, setMailboxes] = useState<Mailbox[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [activeMailbox, setActiveMailbox] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    async function loadMailboxes() {
      const res = await fetch("/api/mailboxes");
      if (!res.ok) {
        return;
      }
      const payload = await res.json();
      setMailboxes(payload.mailboxes ?? []);
      if (payload.mailboxes?.[0]) {
        setActiveMailbox(payload.mailboxes[0].id);
      }
    }

    void loadMailboxes();
  }, []);

  useEffect(() => {
    async function loadMessages() {
      if (!activeMailbox) {
        setMessages([]);
        return;
      }
      const res = await fetch(`/api/mailboxes/${activeMailbox}/messages`);
      if (!res.ok) {
        return;
      }
      const payload = await res.json();
      setMessages(payload.messages ?? []);
    }

    void loadMessages();
  }, [activeMailbox]);

  return (
    <main>
      <div className="container">
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
          <div>
            <h1>Mailboxes</h1>
            <p>Inbound and outbound emails will appear here once ingested.</p>
          </div>
          <button
            type="button"
            disabled={signingOut}
            onClick={async () => {
              setSigningOut(true);
              await fetch("/api/auth/logout", { method: "POST" });
              window.location.href = "/login";
            }}
            style={{
              padding: "10px 14px",
              borderRadius: 10,
              border: "1px solid #ddd",
              background: "#fff",
              cursor: "pointer",
              height: 40
            }}
          >
            {signingOut ? "Signing out..." : "Sign out"}
          </button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", gap: 24 }}>
          <aside style={{ borderRight: "1px solid #eee", paddingRight: 16 }}>
            {mailboxes.map((mailbox) => (
              <button
                key={mailbox.id}
                type="button"
                onClick={() => setActiveMailbox(mailbox.id)}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  padding: "10px 12px",
                  marginBottom: 8,
                  borderRadius: 10,
                  border: "1px solid #eee",
                  background: mailbox.id === activeMailbox ? "#1a1a1a" : "#fff",
                  color: mailbox.id === activeMailbox ? "#fff" : "#1a1a1a",
                  cursor: "pointer"
                }}
              >
                <strong>{mailbox.type === "platform" ? "Platform" : "Personal"}</strong>
                <div style={{ fontSize: 12 }}>{mailbox.address}</div>
              </button>
            ))}
          </aside>

          <section style={{ display: "grid", gap: 12 }}>
            {messages.length === 0 ? (
              <p>No messages yet.</p>
            ) : (
              messages.map((message) => (
                <article
                  key={message.id}
                  style={{
                    border: "1px solid #eee",
                    borderRadius: 12,
                    padding: 12
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <strong>{message.subject ?? "(no subject)"}</strong>
                    <span style={{ fontSize: 12 }}>
                      {message.received_at ?? message.sent_at ?? ""}
                    </span>
                  </div>
                  <p style={{ marginTop: 6 }}>{message.preview_text ?? ""}</p>
                  <p style={{ fontSize: 12, color: "#555" }}>
                    {message.direction === "inbound" ? "From" : "To"}: {message.from_email}
                  </p>
                </article>
              ))
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
