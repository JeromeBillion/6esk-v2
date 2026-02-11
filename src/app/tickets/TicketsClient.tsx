"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import AppShell from "@/app/components/AppShell";

type Ticket = {
  id: string;
  requester_email: string;
  subject: string | null;
  category?: string | null;
  tags?: string[];
  status: string;
  priority: string;
  assigned_user_id: string | null;
  created_at: string;
  updated_at: string;
};

type Message = {
  id: string;
  direction: "inbound" | "outbound";
  channel: "email" | "whatsapp";
  origin: "human" | "ai";
  from_email: string;
  subject: string | null;
  preview_text: string | null;
  received_at: string | null;
  sent_at: string | null;
  wa_status?: string | null;
  wa_timestamp?: string | null;
  wa_contact?: string | null;
  conversation_id?: string | null;
};

type MessageDetail = {
  id: string;
  subject: string | null;
  from: string;
  to: string[];
  direction: "inbound" | "outbound";
  channel: "email" | "whatsapp";
  origin: "human" | "ai";
  isSpam: boolean;
  spamReason?: string | null;
  receivedAt: string | null;
  sentAt: string | null;
  waStatus?: string | null;
  waTimestamp?: string | null;
  waContact?: string | null;
  conversationId?: string | null;
  text: string | null;
  html: string | null;
};

type Draft = {
  id: string;
  subject: string | null;
  body_text: string | null;
  body_html: string | null;
  confidence: number | null;
  status?: string;
  created_at: string;
};

type Attachment = {
  id: string;
  filename: string;
  content_type: string | null;
  size_bytes: number | null;
};

type TicketEvent = {
  id: string;
  event_type: string;
  actor_user_id: string | null;
  data: Record<string, unknown> | null;
  created_at: string;
};

type AuditLog = {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  data: Record<string, unknown> | null;
  created_at: string;
  actor_name?: string | null;
  actor_email?: string | null;
};

type SessionUser = {
  id: string;
  email: string;
  role_name?: string | null;
};

type Macro = {
  id: string;
  title: string;
  body: string;
  category?: string | null;
};

type WhatsAppTemplate = {
  id: string;
  provider: string;
  name: string;
  language: string;
  category?: string | null;
  status: string;
  components?: Array<Record<string, unknown>> | null;
};

const STATUS_OPTIONS = ["new", "open", "pending", "solved", "closed"];
const WHATSAPP_STATUS_STEPS = ["queued", "sent", "delivered", "read"] as const;
const WHATSAPP_STATUS_INDEX: Record<string, number> = {
  queued: 0,
  sent: 1,
  delivered: 2,
  read: 3
};

export default function TicketsClient() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [activeTicketId, setActiveTicketId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [draftEdits, setDraftEdits] = useState<Record<string, string>>({});
  const [editingDraftId, setEditingDraftId] = useState<string | null>(null);
  const [savingDraftId, setSavingDraftId] = useState<string | null>(null);
  const [sendingDraftId, setSendingDraftId] = useState<string | null>(null);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [replyText, setReplyText] = useState("");
  const [sending, setSending] = useState(false);
  const replyRef = useRef<HTMLTextAreaElement | null>(null);
  const [macros, setMacros] = useState<Macro[]>([]);
  const [selectedMacro, setSelectedMacro] = useState<string>("");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterPriority, setFilterPriority] = useState<string>("all");
  const [filterTag, setFilterTag] = useState<string>("all");
  const [filterQuery, setFilterQuery] = useState<string>("");
  const [assignedFilter, setAssignedFilter] = useState<string>("all");
  const [activeMessageId, setActiveMessageId] = useState<string | null>(null);
  const [messageDetail, setMessageDetail] = useState<MessageDetail | null>(null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [loadingMessage, setLoadingMessage] = useState(false);
  const [events, setEvents] = useState<TicketEvent[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [replyError, setReplyError] = useState<string | null>(null);
  const [waTemplateName, setWaTemplateName] = useState("");
  const [waTemplateLanguage, setWaTemplateLanguage] = useState("en_US");
  const [waTemplateParams, setWaTemplateParams] = useState("");
  const [whatsappTemplates, setWhatsappTemplates] = useState<WhatsAppTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");

  function formatMessageTimestamp(message: Message) {
    const value = message.received_at ?? message.sent_at;
    return value ? new Date(value).toLocaleString() : "—";
  }

  function getTemplateParamCount(template?: WhatsAppTemplate | null) {
    if (!template?.components) return null;
    let count = 0;
    for (const component of template.components) {
      if (!component || typeof component !== "object") continue;
      const params = (component as Record<string, unknown>).parameters;
      if (Array.isArray(params)) {
        count += params.length;
      }
    }
    return count || null;
  }

  function getDraftPlainText(draft: Draft) {
    if (draft.body_text) return draft.body_text;
    if (draft.body_html) {
      return draft.body_html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    }
    return "";
  }

  async function loadUser() {
    const res = await fetch("/api/auth/me");
    if (!res.ok) {
      return;
    }
    const payload = await res.json();
    setUser(payload.user ?? null);
  }

  async function loadTickets() {
    const params = new URLSearchParams();
    if (filterStatus !== "all") params.set("status", filterStatus);
    if (filterPriority !== "all") params.set("priority", filterPriority);
    if (filterTag !== "all") params.set("tag", filterTag);
    if (filterQuery.trim()) params.set("q", filterQuery.trim());
    if (assignedFilter !== "all") params.set("assigned", assignedFilter);

    const res = await fetch(`/api/tickets?${params.toString()}`);
    if (!res.ok) {
      return;
    }
    const payload = await res.json();
    setTickets(payload.tickets ?? []);
    if (payload.tickets?.[0]) {
      setActiveTicketId((current) => {
        if (current && payload.tickets.some((ticket: Ticket) => ticket.id === current)) {
          return current;
        }
        return payload.tickets[0].id;
      });
    } else {
      setActiveTicketId(null);
    }
  }

  async function loadMacros() {
    const res = await fetch("/api/support/macros");
    if (!res.ok) {
      return;
    }
    const payload = await res.json();
    setMacros(payload.macros ?? []);
  }

  async function loadWhatsAppTemplates() {
    const res = await fetch("/api/whatsapp/templates");
    if (!res.ok) {
      return;
    }
    const payload = await res.json();
    setWhatsappTemplates(payload.templates ?? []);
  }

  async function loadTicketDetail(ticketId: string) {
    const res = await fetch(`/api/tickets/${ticketId}`);
    if (!res.ok) {
      return;
    }
    const payload = await res.json();
    setMessages(payload.messages ?? []);
    setDrafts(payload.drafts ?? []);
    setEvents(payload.events ?? []);
    setAuditLogs(payload.auditLogs ?? []);
    const updatedTicket = payload.ticket;
    if (updatedTicket) {
      setTickets((prev) => prev.map((ticket) => (ticket.id === updatedTicket.id ? updatedTicket : ticket)));
    }
  }

  async function loadMessageDetail(messageId: string) {
    setLoadingMessage(true);
    setActiveMessageId(messageId);
    const res = await fetch(`/api/messages/${messageId}`);
    if (res.ok) {
      const payload = await res.json();
      setMessageDetail(payload.message);
      setAttachments(payload.attachments ?? []);
    }
    setLoadingMessage(false);
  }

  async function toggleSpam(messageId: string, isSpam: boolean) {
    const res = await fetch(`/api/messages/${messageId}/spam`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isSpam, reason: isSpam ? "manual_flag" : null })
    });
    if (res.ok) {
      await loadMessageDetail(messageId);
    }
  }

  useEffect(() => {
    void loadUser();
    void loadMacros();
  }, []);

  useEffect(() => {
    void loadTickets();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterStatus, filterPriority, filterTag, filterQuery, assignedFilter]);

  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target) {
        const tagName = target.tagName;
        if (tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT") {
          return;
        }
      }
      if (event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      if (tickets.length === 0) {
        return;
      }

      const currentIndex = tickets.findIndex((ticket) => ticket.id === activeTicketId);

      if (event.key === "j" || event.key === "ArrowDown") {
        event.preventDefault();
        const nextIndex = currentIndex < tickets.length - 1 ? currentIndex + 1 : 0;
        setActiveTicketId(tickets[nextIndex].id);
      }

      if (event.key === "k" || event.key === "ArrowUp") {
        event.preventDefault();
        const nextIndex = currentIndex > 0 ? currentIndex - 1 : tickets.length - 1;
        setActiveTicketId(tickets[nextIndex].id);
      }

      if (event.key === "r") {
        event.preventDefault();
        replyRef.current?.focus();
      }
    }

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [tickets, activeTicketId]);

  useEffect(() => {
    if (!activeTicketId) {
      setMessages([]);
      setDrafts([]);
      setAuditLogs([]);
      setEditingDraftId(null);
      setDraftEdits({});
      return;
    }
    setEditingDraftId(null);
    setDraftEdits({});
    void loadTicketDetail(activeTicketId);
  }, [activeTicketId]);

  useEffect(() => {
    if (messages.some((message) => message.channel === "whatsapp")) {
      void loadWhatsAppTemplates();
    }
  }, [messages, activeTicketId]);

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
    setReplyError(null);
    const trimmedText = replyText.trim();
    const selectedTemplate =
      whatsappTemplates.find((template) => template.id === selectedTemplateId) ?? null;
    const templateName = selectedTemplate?.name ?? waTemplateName.trim();
    const templateLanguage = selectedTemplate?.language ?? waTemplateLanguage.trim();
    const shouldBuildTemplate =
      ticketChannel === "whatsapp" && templateName && templateLanguage;
    let template: { name: string; language: string; components?: Array<Record<string, unknown>> } | null = null;

    if (shouldBuildTemplate) {
      const params = waTemplateParams
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
      const requiredParams = getTemplateParamCount(selectedTemplate);
      if (requiredParams && params.length < requiredParams) {
        setReplyError(`Template requires at least ${requiredParams} parameter(s).`);
        return;
      }
      const storedComponents = selectedTemplate?.components ?? null;
      template = {
        name: templateName,
        language: templateLanguage,
        components: params.length
          ? [
              {
                type: "body",
                parameters: params.map((param) => ({ type: "text", text: param }))
              }
            ]
          : storedComponents ?? undefined
      };
    }

    if (ticketChannel === "whatsapp" && whatsappWindow && !whatsappWindow.isOpen && !template) {
      setReplyError("WhatsApp 24h window is closed. Select a template.");
      return;
    }

    if (!trimmedText && !template) {
      setReplyError(
        ticketChannel === "whatsapp"
          ? "Add a reply or provide a template."
          : "Reply body required."
      );
      return;
    }
    setSending(true);
    const res = await fetch(`/api/tickets/${ticketId}/replies`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: trimmedText || null,
        template
      })
    });
    if (res.ok) {
      setReplyText("");
      setWaTemplateName("");
      setWaTemplateParams("");
      setSelectedTemplateId("");
      await loadTicketDetail(ticketId);
    } else {
      const payload = await res.json().catch(() => ({}));
      setReplyError(payload.error ?? "Failed to send reply");
    }
    setSending(false);
  }

  async function saveDraftEdit(ticketId: string, draftId: string) {
    const text = draftEdits[draftId] ?? "";
    if (!text.trim()) {
      return false;
    }

    setSavingDraftId(draftId);
    const res = await fetch(`/api/tickets/${ticketId}/drafts/${draftId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bodyText: text, bodyHtml: null })
    });
    if (res.ok) {
      await loadTicketDetail(ticketId);
    }
    setSavingDraftId(null);
    return res.ok;
  }

  async function sendDraft(ticketId: string, draft: Draft) {
    const editText = editingDraftId === draft.id ? draftEdits[draft.id] ?? "" : "";
    if (!draft.body_text && !draft.body_html && !editText.trim()) return;
    setSendingDraftId(draft.id);

    if (editingDraftId === draft.id) {
      const saved = await saveDraftEdit(ticketId, draft.id);
      if (!saved) {
        setSendingDraftId(null);
        return;
      }
    }

    const res = await fetch(`/api/tickets/${ticketId}/drafts/${draft.id}/send`, {
      method: "POST"
    });
    if (res.ok) {
      setEditingDraftId(null);
      await loadTicketDetail(ticketId);
    }
    setSendingDraftId(null);
  }

  async function updateDraftStatus(ticketId: string, draftId: string, status: "used" | "dismissed") {
    const res = await fetch(`/api/tickets/${ticketId}/drafts/${draftId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status })
    });
    if (res.ok) {
      await loadTicketDetail(ticketId);
    }
  }

  const activeTicket = tickets.find((ticket) => ticket.id === activeTicketId) ?? null;
  const ticketChannel = messages.some((message) => message.channel === "whatsapp")
    ? "whatsapp"
    : "email";
  const activeTemplates = whatsappTemplates.filter((template) => template.status === "active");
  const selectedTemplate =
    whatsappTemplates.find((template) => template.id === selectedTemplateId) ?? null;
  const selectedTemplateParamCount = getTemplateParamCount(selectedTemplate);
  const whatsappWindow = (() => {
    if (ticketChannel !== "whatsapp") {
      return null;
    }
    const inboundTimes = messages
      .filter((message) => message.channel === "whatsapp" && message.direction === "inbound")
      .map((message) => (message.received_at ? Date.parse(message.received_at) : NaN))
      .filter((value) => !Number.isNaN(value));
    if (inboundTimes.length === 0) {
      return { isOpen: false, minutesRemaining: 0 };
    }
    const lastInbound = Math.max(...inboundTimes);
    const expires = lastInbound + 24 * 60 * 60 * 1000;
    const now = Date.now();
    const isOpen = now <= expires;
    const minutesRemaining = isOpen ? Math.max(0, Math.ceil((expires - now) / 60000)) : 0;
    return { isOpen, minutesRemaining };
  })();
  return (
    <AppShell
      title="Tickets"
      subtitle="Support inbox mapped to tickets."
      actions={
        <a href="/tickets/new" className="app-action">
          New ticket
        </a>
      }
    >
      <div className="app-content">
        <div className="tickets-layout">
          <aside className="panel tickets-sidebar">
            <div className="tickets-filters">
              <label>
                Search
                <input
                  type="text"
                  placeholder="Subject or requester"
                  value={filterQuery}
                  onChange={(event) => setFilterQuery(event.target.value)}
                />
              </label>
              {user?.role_name === "lead_admin" ? (
                <label>
                  Assignment
                  <select
                    value={assignedFilter}
                    onChange={(event) => setAssignedFilter(event.target.value)}
                  >
                    <option value="all">All</option>
                    <option value="mine">My tickets</option>
                  </select>
                </label>
              ) : null}
              <label>
                Status
                <select
                  value={filterStatus}
                  onChange={(event) => setFilterStatus(event.target.value)}
                >
                  <option value="all">All</option>
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
                  value={filterPriority}
                  onChange={(event) => setFilterPriority(event.target.value)}
                >
                  <option value="all">All</option>
                  {["low", "normal", "high", "urgent"].map((priority) => (
                    <option key={priority} value={priority}>
                      {priority}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Tag
                <select value={filterTag} onChange={(event) => setFilterTag(event.target.value)}>
                  <option value="all">All</option>
                  {Array.from(
                    new Set(tickets.flatMap((ticket) => ticket.tags ?? []))
                  ).map((tag) => (
                    <option key={tag} value={tag}>
                      {tag}
                    </option>
                  ))}
                </select>
              </label>
              <div style={{ fontSize: 12, color: "var(--muted)" }}>
                Shortcuts: <code>j</code>/<code>k</code> to move · <code>r</code> to reply
              </div>
            </div>
            {tickets.length === 0 ? (
              <div className="ticket-empty">
                <h3>No tickets yet</h3>
                <p>Send an email to support or create a ticket manually.</p>
                <a href="/tickets/new" className="app-action">
                  Create ticket
                </a>
              </div>
            ) : (
              tickets.map((ticket) => (
                <button
                  key={ticket.id}
                  type="button"
                  onClick={() => setActiveTicketId(ticket.id)}
                  className={`ticket-card${ticket.id === activeTicketId ? " active" : ""}`}
                >
                  <strong>{ticket.subject ?? "(no subject)"}</strong>
                  <div style={{ fontSize: 12 }}>{ticket.requester_email}</div>
                  <div style={{ fontSize: 12 }}>Status: {ticket.status}</div>
                  {ticket.category ? (
                    <div style={{ fontSize: 12 }}>Category: {ticket.category}</div>
                  ) : null}
                  {ticket.tags && ticket.tags.length ? (
                    <div style={{ fontSize: 12 }}>Tags: {ticket.tags.join(", ")}</div>
                  ) : null}
                </button>
              ))
            )}
          </aside>

          <section className="tickets-detail">
            {!activeTicket ? (
              <div className="panel ticket-empty">
                <h3>Select a ticket</h3>
                <p>Choose a ticket on the left to see conversation, drafts, and activity.</p>
              </div>
            ) : (
              <div className="tickets-detail-stack">
                <div
                  style={{
                    border: "1px solid var(--border)",
                    borderRadius: 12,
                    padding: 16,
                    background: "rgba(10, 12, 18, 0.6)"
                  }}
                >
                  <h2 style={{ margin: 0 }}>{activeTicket.subject ?? "(no subject)"}</h2>
                  <p>
                    Requester:{" "}
                    {activeTicket.requester_email.startsWith("whatsapp:")
                      ? `WhatsApp ${activeTicket.requester_email.replace(/^whatsapp:/, "")}`
                      : activeTicket.requester_email}
                  </p>
                  {activeTicket.category ? <p>Category: {activeTicket.category}</p> : null}
                  {activeTicket.tags && activeTicket.tags.length ? (
                    <p>Tags: {activeTicket.tags.join(", ")}</p>
                  ) : null}
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
                          border: "1px solid var(--border)",
                          background: "var(--surface-2)",
                          color: "var(--text)",
                          cursor: "pointer"
                        }}
                      >
                        Assign to me
                      </button>
                    ) : null}
                  </div>
                </div>

                <div
                  style={{
                    border: "1px solid var(--border)",
                    borderRadius: 12,
                    padding: 16,
                    background: "rgba(10, 12, 18, 0.6)"
                  }}
                >
                  <h3>{ticketChannel === "whatsapp" ? "WhatsApp Thread" : "Conversation"}</h3>
                  {ticketChannel === "whatsapp" ? (
                    <div className="whatsapp-thread">
                      {messages.length === 0 ? (
                        <p>No WhatsApp messages yet.</p>
                      ) : (
                        messages.map((message) => {
                          const isOutbound = message.direction === "outbound";
                          return (
                            <button
                              key={message.id}
                              type="button"
                              onClick={() => loadMessageDetail(message.id)}
                              className={`whatsapp-bubble ${isOutbound ? "outbound" : "inbound"}${
                                message.id === activeMessageId ? " active" : ""
                              }`}
                            >
                              <div className="whatsapp-text">
                                {message.preview_text ?? "(no message body)"}
                              </div>
                              <div className="whatsapp-meta">
                                <span>{formatMessageTimestamp(message)}</span>
                                {isOutbound ? (
                                  <span className="whatsapp-status">
                                    {message.wa_status ?? "queued"}
                                  </span>
                                ) : null}
                              </div>
                            </button>
                          );
                        })
                      )}
                    </div>
                  ) : (
                    <div style={{ display: "grid", gap: 12 }}>
                      {messages.map((message) => (
                        <article
                          key={message.id}
                          onClick={() => loadMessageDetail(message.id)}
                          style={{
                            border: "1px solid var(--border)",
                            borderRadius: 10,
                            padding: 12,
                            background:
                              message.id === activeMessageId
                                ? "rgba(57, 184, 255, 0.15)"
                                : "rgba(10, 12, 18, 0.6)",
                            cursor: "pointer"
                          }}
                        >
                          <strong>{message.subject ?? "(no subject)"}</strong>
                          <p style={{ marginTop: 6 }}>{message.preview_text ?? ""}</p>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, fontSize: 12 }}>
                            <span style={{ color: "var(--muted)" }}>
                              {message.direction === "inbound" ? "From" : "To"}: {message.from_email}
                            </span>
                            <span
                              style={{
                                padding: "2px 6px",
                                borderRadius: 999,
                                background:
                                  message.channel === "whatsapp"
                                    ? "rgba(82, 210, 113, 0.2)"
                                    : "rgba(139, 215, 255, 0.2)",
                                color: message.channel === "whatsapp" ? "#7ff5a2" : "var(--text)"
                              }}
                            >
                              {message.channel === "whatsapp" ? "WhatsApp" : "Email"}
                            </span>
                            <span style={{ color: "var(--muted)" }}>
                              {message.origin === "ai" ? "AI" : "Human"}
                            </span>
                            {message.channel === "whatsapp" && message.wa_status ? (
                              <span style={{ color: "var(--muted)" }}>{message.wa_status}</span>
                            ) : null}
                          </div>
                        </article>
                      ))}
                    </div>
                  )}
                  <div style={{ marginTop: 16 }}>
                    <h4>Message Detail</h4>
                    {loadingMessage ? <p>Loading...</p> : null}
                    {!messageDetail ? (
                      <p>Select a message to view full body.</p>
                    ) : (
                      <div style={{ display: "grid", gap: 12 }}>
                        <div style={{ fontSize: 12, color: "var(--muted)" }}>
                          From: {messageDetail.from} · To: {messageDetail.to.join(", ")} ·
                          {messageDetail.origin === "ai" ? " AI" : " Human"} ·
                          {messageDetail.channel === "whatsapp" ? " WhatsApp" : " Email"}
                        </div>
                        {messageDetail.channel === "whatsapp" ? (
                          <div style={{ display: "grid", gap: 6 }}>
                            <div style={{ fontSize: 12, color: "var(--muted)" }}>
                              Status: {messageDetail.waStatus ?? "—"} · Contact:{" "}
                              {messageDetail.waContact ?? messageDetail.from}
                            </div>
                            {messageDetail.direction === "outbound" ? (
                              <div className="wa-status-track">
                                {WHATSAPP_STATUS_STEPS.map((step) => {
                                  const status = (messageDetail.waStatus ?? "queued").toLowerCase();
                                  const isFailed = status === "failed";
                                  const isActive =
                                    !isFailed &&
                                    (WHATSAPP_STATUS_INDEX[status] ?? 0) >=
                                      WHATSAPP_STATUS_INDEX[step];
                                  return (
                                    <span
                                      key={step}
                                      className={`wa-status-step${isActive ? " active" : ""}${
                                        isFailed ? " failed" : ""
                                      }`}
                                    >
                                      {step}
                                    </span>
                                  );
                                })}
                                <span className="wa-status-timestamp">
                                  Updated:{" "}
                                  {messageDetail.waTimestamp
                                    ? new Date(messageDetail.waTimestamp).toLocaleString()
                                    : "—"}
                                </span>
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                          <span style={{ fontSize: 12, color: "var(--muted)" }}>
                            Spam: {messageDetail.isSpam ? "Yes" : "No"}
                          </span>
                          <button
                            type="button"
                            onClick={() => toggleSpam(messageDetail.id, !messageDetail.isSpam)}
                            style={{
                              padding: "6px 10px",
                              borderRadius: 8,
                              border: "1px solid var(--border)",
                              background: "var(--surface-2)",
                              color: "var(--text)",
                              cursor: "pointer"
                            }}
                          >
                            {messageDetail.isSpam ? "Not spam" : "Mark spam"}
                          </button>
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
                      </div>
                    )}
                  </div>
                </div>

                <div
                  style={{
                    border: "1px solid var(--border)",
                    borderRadius: 12,
                    padding: 16,
                    background: "rgba(10, 12, 18, 0.6)"
                  }}
                >
                  <h3>Activity</h3>
                  {events.length === 0 ? (
                    <p>No activity yet.</p>
                  ) : (
                    <div style={{ display: "grid", gap: 8 }}>
                      {events.map((event) => (
                        <div key={event.id} style={{ fontSize: 13, color: "var(--muted)" }}>
                          {new Date(event.created_at).toLocaleString()} · {event.event_type}
                        </div>
                      ))}
                    </div>
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
                  <h3>Audit Trail</h3>
                  {auditLogs.length === 0 ? (
                    <p>No audit entries yet.</p>
                  ) : (
                    <div style={{ display: "grid", gap: 8 }}>
                      {auditLogs.map((log) => (
                        <div key={log.id} style={{ fontSize: 13, color: "var(--muted)" }}>
                          {new Date(log.created_at).toLocaleString()} · {log.action} ·{" "}
                          {log.actor_name ?? log.actor_email ?? "System"}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {drafts.length ? (
                  <div
                    style={{
                      border: "1px solid var(--border)",
                      borderRadius: 12,
                      padding: 16,
                      background: "rgba(10, 12, 18, 0.6)"
                    }}
                  >
                    <h3>AI Drafts</h3>
                    <p style={{ color: "var(--muted)", fontSize: 13 }}>
                      Draft-only by default. Auto-send is controlled in the admin panel.
                    </p>
                    <div style={{ display: "grid", gap: 12 }}>
                      {drafts.map((draft) => {
                        const isEditing = editingDraftId === draft.id;
                        const draftText = draftEdits[draft.id] ?? getDraftPlainText(draft);

                        return (
                          <div
                            key={draft.id}
                            style={{
                              border: "1px solid var(--border)",
                              borderRadius: 10,
                              padding: 12,
                              background: "rgba(10, 12, 18, 0.6)"
                            }}
                          >
                            <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>
                              {new Date(draft.created_at).toLocaleString()}
                              {draft.status ? ` · ${draft.status}` : ""}
                              {draft.confidence !== null && draft.confidence !== undefined
                                ? ` · ${(draft.confidence * 100).toFixed(0)}% confidence`
                                : ""}
                            </div>
                            {isEditing ? (
                              <textarea
                                rows={6}
                                value={draftText}
                                onChange={(event) =>
                                  setDraftEdits((prev) => ({
                                    ...prev,
                                    [draft.id]: event.target.value
                                  }))
                                }
                                style={{
                                  width: "100%",
                                  padding: 10,
                                  borderRadius: 8,
                                  border: "1px solid var(--border)",
                                  background: "var(--surface-2)",
                                  color: "var(--text)"
                                }}
                              />
                            ) : draft.body_html ? (
                              <div
                                style={{
                                  border: "1px solid var(--border)",
                                  borderRadius: 10,
                                  padding: 12,
                                  background: "rgba(10, 12, 18, 0.6)"
                                }}
                                dangerouslySetInnerHTML={{ __html: draft.body_html }}
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
                                {draft.body_text ?? "No draft body provided."}
                              </pre>
                            )}
                            <div
                              style={{
                                display: "flex",
                                flexWrap: "wrap",
                                gap: 8,
                                marginTop: 10
                              }}
                            >
                              <button
                                type="button"
                                onClick={() => {
                                  if (!draftText.trim()) return;
                                  setReplyText(draftText);
                                }}
                                style={{
                                  padding: "8px 12px",
                                  borderRadius: 8,
                                  border: "1px solid var(--border)",
                                  background: "var(--surface-2)",
                                  color: "var(--text)",
                                  cursor: "pointer"
                                }}
                              >
                                Insert into reply
                              </button>
                              <button
                                type="button"
                                onClick={() => sendDraft(activeTicket.id, draft)}
                                disabled={sendingDraftId === draft.id}
                                style={{
                                  padding: "8px 12px",
                                  borderRadius: 8,
                                  border: "1px solid var(--border)",
                                  background: "var(--surface-2)",
                                  color: "var(--text)",
                                  cursor: "pointer"
                                }}
                              >
                                {sendingDraftId === draft.id ? "Sending..." : "Approve & send"}
                              </button>
                              {!isEditing ? (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingDraftId(draft.id);
                                    setDraftEdits((prev) => ({
                                      ...prev,
                                      [draft.id]: prev[draft.id] ?? getDraftPlainText(draft)
                                    }));
                                  }}
                                  style={{
                                    padding: "8px 12px",
                                    borderRadius: 8,
                                    border: "1px solid var(--border)",
                                    background: "transparent",
                                    color: "var(--muted)",
                                    cursor: "pointer"
                                  }}
                                >
                                  Edit draft
                                </button>
                              ) : null}
                              {isEditing ? (
                                <button
                                  type="button"
                                  onClick={() => saveDraftEdit(activeTicket.id, draft.id)}
                                  disabled={savingDraftId === draft.id}
                                  style={{
                                    padding: "8px 12px",
                                    borderRadius: 8,
                                    border: "1px solid var(--border)",
                                    background: "var(--surface-2)",
                                    color: "var(--text)",
                                    cursor: "pointer"
                                  }}
                                >
                                  {savingDraftId === draft.id ? "Saving..." : "Save draft"}
                                </button>
                              ) : null}
                              {isEditing ? (
                                <button
                                  type="button"
                                  onClick={() => setEditingDraftId(null)}
                                  style={{
                                    padding: "8px 12px",
                                    borderRadius: 8,
                                    border: "1px solid var(--border)",
                                    background: "transparent",
                                    color: "var(--muted)",
                                    cursor: "pointer"
                                  }}
                                >
                                  Cancel
                                </button>
                              ) : null}
                              <button
                                type="button"
                                onClick={() => updateDraftStatus(activeTicket.id, draft.id, "dismissed")}
                                style={{
                                  padding: "8px 12px",
                                  borderRadius: 8,
                                  border: "1px solid var(--border)",
                                  background: "transparent",
                                  color: "var(--muted)",
                                  cursor: "pointer"
                                }}
                              >
                                Dismiss
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : null}

                <div
                  style={{
                    border: "1px solid var(--border)",
                    borderRadius: 12,
                    padding: 16,
                    background: "rgba(10, 12, 18, 0.6)"
                  }}
                >
                  <h3>{ticketChannel === "whatsapp" ? "WhatsApp Reply" : "Reply"}</h3>
                  {ticketChannel === "whatsapp" ? (
                    <p style={{ fontSize: 12, color: "var(--muted)", marginTop: -6 }}>
                      Replies send through the connected WhatsApp Business number.
                    </p>
                  ) : null}
                  {ticketChannel === "whatsapp" && whatsappWindow ? (
                    <div style={{ fontSize: 12, color: "var(--muted)" }}>
                      24h window:{" "}
                      {whatsappWindow.isOpen
                        ? `Open (${whatsappWindow.minutesRemaining}m left)`
                        : "Closed (template required)"}
                    </div>
                  ) : null}
                  {macros.length ? (
                    <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                      <select
                        value={selectedMacro}
                        onChange={(event) => setSelectedMacro(event.target.value)}
                        style={{ maxWidth: 280 }}
                      >
                        <option value="">Insert macro...</option>
                        {macros.map((macro) => (
                          <option key={macro.id} value={macro.id}>
                            {macro.title}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => {
                          const macro = macros.find((item) => item.id === selectedMacro);
                          if (!macro) return;
                          setReplyText((prev) => (prev ? `${prev}\n\n${macro.body}` : macro.body));
                        }}
                        style={{
                          padding: "8px 12px",
                          borderRadius: 8,
                          border: "1px solid var(--border)",
                          background: "var(--surface-2)",
                          color: "var(--text)",
                          cursor: "pointer"
                        }}
                      >
                        Insert
                      </button>
                    </div>
                  ) : null}
                  <textarea
                    ref={replyRef}
                    value={replyText}
                    onChange={(event) => setReplyText(event.target.value)}
                    rows={5}
                    style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid var(--border)" }}
                  />
                  {ticketChannel === "whatsapp" ? (
                    <div style={{ display: "grid", gap: 8 }}>
                      <label>
                        Template
                        <select
                          value={selectedTemplateId}
                          onChange={(event) => {
                            const selectedId = event.target.value;
                            setSelectedTemplateId(selectedId);
                            if (!selectedId) {
                              setWaTemplateName("");
                              setWaTemplateLanguage("en_US");
                              setWaTemplateParams("");
                              return;
                            }
                            const template = whatsappTemplates.find((item) => item.id === selectedId);
                            if (template) {
                              setWaTemplateName(template.name);
                              setWaTemplateLanguage(template.language);
                            }
                          }}
                        >
                          <option value="">No template</option>
                          {activeTemplates.map((template) => (
                            <option key={template.id} value={template.id}>
                              {template.name} ({template.language})
                            </option>
                          ))}
                        </select>
                      </label>
                      {selectedTemplateId || (whatsappWindow && !whatsappWindow.isOpen) ? (
                        <label>
                          Template params (comma-separated)
                          <input
                            type="text"
                            value={waTemplateParams}
                            onChange={(event) => setWaTemplateParams(event.target.value)}
                            placeholder="orderId, deliveryDate"
                          />
                          {selectedTemplateParamCount ? (
                            <span style={{ fontSize: 12, color: "var(--muted)" }}>
                              Requires at least {selectedTemplateParamCount} parameter(s).
                            </span>
                          ) : null}
                        </label>
                      ) : null}
                    </div>
                  ) : null}
                  {replyError ? <p style={{ color: "var(--danger)" }}>{replyError}</p> : null}
                  <button
                    type="button"
                    onClick={() => sendReply(activeTicket.id)}
                    disabled={sending}
                    style={{
                      marginTop: 12,
                      padding: "10px 14px",
                      borderRadius: 10,
                      border: "none",
                      background: "linear-gradient(135deg, var(--accent-strong), var(--accent))",
                      color: "#081018",
                      cursor: "pointer"
                    }}
                  >
                    {sending
                      ? "Sending..."
                      : ticketChannel === "whatsapp"
                        ? "Send WhatsApp reply"
                        : "Send reply"}
                  </button>
                </div>
              </div>
            )}
          </section>
        </div>
      </div>
    </AppShell>
  );
}
