"use client";

import { useEffect, useState } from "react";

type Ticket = {
  id: string;
  requester_email: string;
  subject: string | null;
  status: string;
  priority: string;
  assigned_user_id: string | null;
  created_at: string;
  updated_at: string;
};

type Message = {
  id: string;
  direction: "inbound" | "outbound";
  from_email: string;
  subject: string | null;
  preview_text: string | null;
  received_at: string | null;
  sent_at: string | null;
};

type SessionUser = {
  id: string;
  email: string;
  role_name?: string | null;
};

const STATUS_OPTIONS = ["new", "open", "pending", "solved", "closed"];

export default function TicketsClient() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [activeTicketId, setActiveTicketId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [replyText, setReplyText] = useState("");
  const [sending, setSending] = useState(false);

  async function loadUser() {
    const res = await fetch("/api/auth/me");
    if (!res.ok) {
      return;
    }
    const payload = await res.json();
    setUser(payload.user ?? null);
  }

  async function loadTickets() {
    const res = await fetch("/api/tickets");
    if (!res.ok) {
      return;
    }
    const payload = await res.json();
    setTickets(payload.tickets ?? []);
    if (payload.tickets?.[0]) {
      setActiveTicketId(payload.tickets[0].id);
    }
  }

  async function loadTicketDetail(ticketId: string) {
    const res = await fetch(`/api/tickets/${ticketId}`);
    if (!res.ok) {
      return;
    }
    const payload = await res.json();
    setMessages(payload.messages ?? []);
    const updatedTicket = payload.ticket;
    if (updatedTicket) {
      setTickets((prev) => prev.map((ticket) => (ticket.id === updatedTicket.id ? updatedTicket : ticket)));
    }
  }

  useEffect(() => {
    void loadUser();
    void loadTickets();
  }, []);

  useEffect(() => {
    if (!activeTicketId) {
      setMessages([]);
      return;
    }
    void loadTicketDetail(activeTicketId);
  }, [activeTicketId]);

  async function updateTicket(ticketId: string, updates: Partial<Ticket> & { assigned_user_id?: string | null }) {
    const payload: Record<string, unknown> = {};
    if (updates.status) payload.status = updates.status;
    if (updates.priority) payload.priority = updates.priority;
    if (Object.prototype.hasOwnProperty.call(updates, "assigned_user_id")) {
      payload.assignedUserId = updates.assigned_user_id;
    }

    const res = await fetch(`/api/tickets/${ticketId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (res.ok) {
      const data = await res.json();
      setTickets((prev) => prev.map((ticket) => (ticket.id === ticketId ? data.ticket : ticket)));
    }
  }

  async function sendReply(ticketId: string) {
    if (!replyText.trim()) return;
    setSending(true);
    const res = await fetch(`/api/tickets/${ticketId}/replies`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: replyText })
    });
    if (res.ok) {
      setReplyText("");
      await loadTicketDetail(ticketId);
    }
    setSending(false);
  }

  const activeTicket = tickets.find((ticket) => ticket.id === activeTicketId) ?? null;

  return (
    <main>
      <div className="container">
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
          <div>
            <h1>Tickets</h1>
            <p>Platform inbox mapped to tickets.</p>
          </div>
          <button
            type="button"
            onClick={async () => {
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
            Sign out
          </button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: 24, marginTop: 24 }}>
          <aside style={{ borderRight: "1px solid #eee", paddingRight: 16 }}>
            {tickets.map((ticket) => (
              <button
                key={ticket.id}
                type="button"
                onClick={() => setActiveTicketId(ticket.id)}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  padding: "10px 12px",
                  marginBottom: 8,
                  borderRadius: 10,
                  border: "1px solid #eee",
                  background: ticket.id === activeTicketId ? "#1a1a1a" : "#fff",
                  color: ticket.id === activeTicketId ? "#fff" : "#1a1a1a",
                  cursor: "pointer"
                }}
              >
                <strong>{ticket.subject ?? "(no subject)"}</strong>
                <div style={{ fontSize: 12 }}>{ticket.requester_email}</div>
                <div style={{ fontSize: 12 }}>Status: {ticket.status}</div>
              </button>
            ))}
          </aside>

          <section>
            {!activeTicket ? (
              <p>Select a ticket to view details.</p>
            ) : (
              <div style={{ display: "grid", gap: 16 }}>
                <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 16 }}>
                  <h2 style={{ margin: 0 }}>{activeTicket.subject ?? "(no subject)"}</h2>
                  <p>Requester: {activeTicket.requester_email}</p>
                  <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                    <label>
                      Status
                      <select
                        value={activeTicket.status}
                        onChange={(event) =>
                          updateTicket(activeTicket.id, { status: event.target.value })
                        }
                        style={{ marginLeft: 8, padding: "6px 8px" }}
                      >
                        {STATUS_OPTIONS.map((status) => (
                          <option key={status} value={status}>
                            {status}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Priority
                      <select
                        value={activeTicket.priority}
                        onChange={(event) =>
                          updateTicket(activeTicket.id, { priority: event.target.value })
                        }
                        style={{ marginLeft: 8, padding: "6px 8px" }}
                      >
                        {["low", "normal", "high", "urgent"].map((priority) => (
                          <option key={priority} value={priority}>
                            {priority}
                          </option>
                        ))}
                      </select>
                    </label>
                    {user ? (
                      <button
                        type="button"
                        onClick={() => updateTicket(activeTicket.id, { assigned_user_id: user.id })}
                        style={{
                          padding: "6px 10px",
                          borderRadius: 8,
                          border: "1px solid #ddd",
                          background: "#fff",
                          cursor: "pointer"
                        }}
                      >
                        Assign to me
                      </button>
                    ) : null}
                  </div>
                </div>

                <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 16 }}>
                  <h3>Conversation</h3>
                  <div style={{ display: "grid", gap: 12 }}>
                    {messages.map((message) => (
                      <article
                        key={message.id}
                        style={{
                          border: "1px solid #f0f0f0",
                          borderRadius: 10,
                          padding: 12
                        }}
                      >
                        <strong>{message.subject ?? "(no subject)"}</strong>
                        <p style={{ marginTop: 6 }}>{message.preview_text ?? ""}</p>
                        <p style={{ fontSize: 12, color: "#555" }}>
                          {message.direction === "inbound" ? "From" : "To"}: {message.from_email}
                        </p>
                      </article>
                    ))}
                  </div>
                </div>

                <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 16 }}>
                  <h3>Reply</h3>
                  <textarea
                    value={replyText}
                    onChange={(event) => setReplyText(event.target.value)}
                    rows={5}
                    style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #ddd" }}
                  />
                  <button
                    type="button"
                    onClick={() => sendReply(activeTicket.id)}
                    disabled={sending}
                    style={{
                      marginTop: 12,
                      padding: "10px 14px",
                      borderRadius: 10,
                      border: "none",
                      background: "#1a1a1a",
                      color: "#fff",
                      cursor: "pointer"
                    }}
                  >
                    {sending ? "Sending..." : "Send reply"}
                  </button>
                </div>
              </div>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
