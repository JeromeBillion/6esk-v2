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
  has_whatsapp?: boolean;
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
  attachments?: Attachment[];
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
  statusEvents?: Array<{ status: string; occurred_at: string | null }>;
  text: string | null;
  html: string | null;
};

type Draft = {
  id: string;
  subject: string | null;
  body_text: string | null;
  body_html: string | null;
  confidence: number | null;
  metadata?: Record<string, unknown> | null;
  status?: string;
  created_at: string;
};

type DraftQueueItem = {
  id: string;
  ticket_id: string;
  subject: string | null;
  body_text: string | null;
  body_html: string | null;
  confidence: number | null;
  metadata?: Record<string, unknown> | null;
  status: string;
  created_at: string;
  ticket_subject: string | null;
  requester_email: string;
  ticket_status: string;
  ticket_priority: string;
  assigned_user_id: string | null;
  has_whatsapp: boolean;
};

type Attachment = {
  id: string;
  filename: string;
  content_type: string | null;
  size_bytes: number | null;
};

type ReplyAttachment = {
  id: string;
  filename: string;
  contentType: string | null;
  size: number;
  contentBase64: string;
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
  const [draftQueue, setDraftQueue] = useState<DraftQueueItem[]>([]);
  const [draftQueueQuery, setDraftQueueQuery] = useState("");
  const [draftQueueChannel, setDraftQueueChannel] = useState<string>("all");
  const [draftQueueAssigned, setDraftQueueAssigned] = useState<string>("all");
  const [draftQueueSelectedIds, setDraftQueueSelectedIds] = useState<string[]>([]);
  const [draftQueueLoading, setDraftQueueLoading] = useState(false);
  const [draftQueueError, setDraftQueueError] = useState<string | null>(null);
  const [draftQueueActionId, setDraftQueueActionId] = useState<string | null>(null);
  const [draftQueueBulkAction, setDraftQueueBulkAction] = useState<string | null>(null);
  const [draftEdits, setDraftEdits] = useState<Record<string, string>>({});
  const [editingDraftId, setEditingDraftId] = useState<string | null>(null);
  const [savingDraftId, setSavingDraftId] = useState<string | null>(null);
  const [sendingDraftId, setSendingDraftId] = useState<string | null>(null);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [replyText, setReplyText] = useState("");
  const [sending, setSending] = useState(false);
  const replyRef = useRef<HTMLTextAreaElement | null>(null);
  const [waReplyAttachments, setWaReplyAttachments] = useState<ReplyAttachment[]>([]);
  const [macros, setMacros] = useState<Macro[]>([]);
  const [selectedMacro, setSelectedMacro] = useState<string>("");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterPriority, setFilterPriority] = useState<string>("all");
  const [filterTag, setFilterTag] = useState<string>("all");
  const [filterChannel, setFilterChannel] = useState<string>("all");
  const [filterQuery, setFilterQuery] = useState<string>("");
  const [assignedFilter, setAssignedFilter] = useState<string>("all");
  const [selectedTicketIds, setSelectedTicketIds] = useState<string[]>([]);
  const [bulkStatus, setBulkStatus] = useState<string>("");
  const [bulkPriority, setBulkPriority] = useState<string>("");
  const [bulkAddTags, setBulkAddTags] = useState("");
  const [bulkRemoveTags, setBulkRemoveTags] = useState("");
  const [bulkUpdating, setBulkUpdating] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [macroQuery, setMacroQuery] = useState("");
  const [ticketDensity, setTicketDensity] = useState<"comfortable" | "compact">("comfortable");
  const [lastSelectedTicketId, setLastSelectedTicketId] = useState<string | null>(null);
  const [waContactCopyStatus, setWaContactCopyStatus] = useState<string | null>(null);
  const [tagInput, setTagInput] = useState("");
  const [tagSaving, setTagSaving] = useState(false);
  const [tagError, setTagError] = useState<string | null>(null);
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
  const [resendingMessageId, setResendingMessageId] = useState<string | null>(null);
  const [resendError, setResendError] = useState<string | null>(null);

  function formatMessageTimestamp(message: Message) {
    const value = message.received_at ?? message.sent_at;
    return value ? new Date(value).toLocaleString() : "—";
  }

  function getMessageDateKey(message: Message) {
    const value = message.received_at ?? message.sent_at;
    if (!value) return "Unknown date";
    const date = new Date(value);
    return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
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

  function getDraftTemplate(draft: Draft) {
    if (!draft.metadata || typeof draft.metadata !== "object") return null;
    const template = (draft.metadata as Record<string, unknown>).template;
    if (!template || typeof template !== "object") return null;
    return template as Record<string, unknown>;
  }

  function getDraftTemplateSummary(draft: Draft) {
    const template = getDraftTemplate(draft);
    if (!template) return null;
    const name = typeof template.name === "string" ? template.name : "template";
    const language = typeof template.language === "string" ? template.language : null;
    const components = Array.isArray(template.components) ? template.components : [];
    let paramCount = 0;
    for (const component of components) {
      if (!component || typeof component !== "object") continue;
      const params = (component as Record<string, unknown>).parameters;
      if (Array.isArray(params)) {
        paramCount += params.length;
      }
    }
    return {
      name,
      language,
      paramCount
    };
  }

  function fileToBase64(file: File) {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = typeof reader.result === "string" ? reader.result : "";
        const [, base64] = result.split(",");
        resolve(base64 ?? "");
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }

  async function handleWaAttachmentChange(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    if (files.length === 0) return;
    if (waReplyAttachments.length >= 1) {
      setReplyError("WhatsApp supports one attachment per message.");
      event.target.value = "";
      return;
    }
    const file = files[0];
    const maxSize = 10 * 1024 * 1024;
    if (file.size > maxSize) {
      setReplyError("Attachments must be 10MB or smaller.");
      event.target.value = "";
      return;
    }
    const contentBase64 = await fileToBase64(file);
    setWaReplyAttachments([
      {
        id:
          typeof crypto !== "undefined" && "randomUUID" in crypto
            ? crypto.randomUUID()
            : `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        filename: file.name,
        contentType: file.type || null,
        size: file.size,
        contentBase64
      }
    ]);
    event.target.value = "";
  }

  function removeWaAttachment(id: string) {
    setWaReplyAttachments((prev) => prev.filter((item) => item.id !== id));
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
    if (filterChannel !== "all") params.set("channel", filterChannel);
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

  async function loadDraftQueue() {
    if (!user) {
      return;
    }
    const params = new URLSearchParams();
    if (draftQueueQuery.trim()) params.set("q", draftQueueQuery.trim());
    if (draftQueueChannel !== "all") params.set("channel", draftQueueChannel);
    if (draftQueueAssigned !== "all") params.set("assigned", draftQueueAssigned);
    setDraftQueueLoading(true);
    setDraftQueueError(null);
    const res = await fetch(`/api/ai-drafts?${params.toString()}`);
    if (!res.ok) {
      setDraftQueueError("Failed to load AI drafts.");
      setDraftQueueLoading(false);
      return;
    }
    const payload = await res.json();
    setDraftQueue(payload.drafts ?? []);
    setDraftQueueLoading(false);
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
  }, [filterStatus, filterPriority, filterTag, filterChannel, filterQuery, assignedFilter]);

  useEffect(() => {
    if (!user) return;
    void loadDraftQueue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, draftQueueQuery, draftQueueChannel, draftQueueAssigned]);

  useEffect(() => {
    if (draftQueueSelectedIds.length === 0) return;
    const validIds = new Set(draftQueue.map((draft) => draft.id));
    setDraftQueueSelectedIds((prev) => prev.filter((id) => validIds.has(id)));
  }, [draftQueue, draftQueueSelectedIds.length]);

  useEffect(() => {
    if (selectedTicketIds.length === 0) return;
    const validIds = new Set(tickets.map((ticket) => ticket.id));
    setSelectedTicketIds((prev) => prev.filter((id) => validIds.has(id)));
  }, [tickets, selectedTicketIds.length]);

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
    setWaReplyAttachments([]);
    setReplyError(null);
    void loadTicketDetail(activeTicketId);
  }, [activeTicketId]);

  useEffect(() => {
    if (messages.some((message) => message.channel === "whatsapp")) {
      void loadWhatsAppTemplates();
    }
  }, [messages, activeTicketId]);

  useEffect(() => {
    if (!activeTicketId) return;
    if (!messages.some((message) => message.channel === "whatsapp")) return;
    const interval = setInterval(() => {
      void loadTicketDetail(activeTicketId);
    }, 20000);
    return () => clearInterval(interval);
  }, [activeTicketId, messages]);

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
    return res.ok;
  }

  async function applyBulkUpdates(updates: Partial<Ticket> & { assigned_user_id?: string | null }) {
    if (selectedTicketIds.length === 0) return;
    setBulkUpdating(true);
    setBulkError(null);
    let failed = 0;
    for (const ticketId of selectedTicketIds) {
      const ok = await updateTicket(ticketId, updates);
      if (!ok) failed += 1;
    }
    setBulkUpdating(false);
    if (failed > 0) {
      setBulkError(`Failed to update ${failed} ticket(s).`);
      return;
    }
    setBulkStatus("");
    setBulkPriority("");
    setSelectedTicketIds([]);
  }

  function parseBulkTags(value: string) {
    return value
      .split(",")
      .map((tag) => tag.trim().toLowerCase())
      .filter(Boolean);
  }

  async function applyBulkTags(action: "add" | "remove") {
    if (selectedTicketIds.length === 0) return;
    const tags = parseBulkTags(action === "add" ? bulkAddTags : bulkRemoveTags);
    if (tags.length === 0) {
      setBulkError("Provide at least one tag.");
      return;
    }
    setBulkUpdating(true);
    setBulkError(null);
    let failed = 0;
    for (const ticketId of selectedTicketIds) {
      const res = await fetch(`/api/tickets/${ticketId}/tags`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          action === "add" ? { addTags: tags } : { removeTags: tags }
        )
      });
      if (!res.ok) {
        failed += 1;
      }
    }
    setBulkUpdating(false);
    if (failed > 0) {
      setBulkError(`Failed to update ${failed} ticket(s).`);
      return;
    }
    setBulkAddTags("");
    setBulkRemoveTags("");
    setSelectedTicketIds([]);
    await loadTickets();
  }

  function parseTagList(value: string) {
    return value
      .split(",")
      .map((tag) => tag.trim().toLowerCase())
      .filter(Boolean);
  }

  async function updateTicketTags(action: "add" | "remove", tags: string[]) {
    if (!activeTicketId) return;
    const clean = Array.from(new Set(tags.map((tag) => tag.toLowerCase().trim()).filter(Boolean)));
    if (clean.length === 0) {
      setTagError("Provide at least one tag.");
      return;
    }
    setTagSaving(true);
    setTagError(null);
    const res = await fetch(`/api/tickets/${activeTicketId}/tags`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(action === "add" ? { addTags: clean } : { removeTags: clean })
    });
    if (!res.ok) {
      const payload = await res.json().catch(() => ({}));
      setTagError(payload.error ?? "Failed to update tags");
      setTagSaving(false);
      return;
    }
    setTagInput("");
    await loadTicketDetail(activeTicketId);
    await loadTickets();
    setTagSaving(false);
  }

  function handleTicketSelection(ticketId: string, checked: boolean, shiftKey: boolean) {
    if (shiftKey && lastSelectedTicketId) {
      const ids = tickets.map((ticket) => ticket.id);
      const startIndex = ids.indexOf(lastSelectedTicketId);
      const endIndex = ids.indexOf(ticketId);
      if (startIndex !== -1 && endIndex !== -1) {
        const [start, end] =
          startIndex <= endIndex ? [startIndex, endIndex] : [endIndex, startIndex];
        const range = ids.slice(start, end + 1);
        setSelectedTicketIds((prev) => {
          const next = new Set(prev);
          if (checked) {
            range.forEach((id) => next.add(id));
          } else {
            range.forEach((id) => next.delete(id));
          }
          return Array.from(next);
        });
        setLastSelectedTicketId(ticketId);
        return;
      }
    }

    setSelectedTicketIds((prev) =>
      checked ? [...new Set([...prev, ticketId])] : prev.filter((id) => id !== ticketId)
    );
    setLastSelectedTicketId(ticketId);
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
    const attachmentPayload =
      ticketChannel === "whatsapp"
        ? waReplyAttachments.map((attachment) => ({
            filename: attachment.filename,
            contentType: attachment.contentType,
            size: attachment.size,
            contentBase64: attachment.contentBase64
          }))
        : [];

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

    if (ticketChannel === "whatsapp" && attachmentPayload.length > 1) {
      setReplyError("WhatsApp supports one attachment per message.");
      return;
    }

    if (ticketChannel === "whatsapp" && attachmentPayload.length && template) {
      setReplyError("Templates cannot be combined with attachments.");
      return;
    }

    if (!trimmedText && !template && attachmentPayload.length === 0) {
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
        template,
        attachments: attachmentPayload.length ? attachmentPayload : null
      })
    });
    if (res.ok) {
      setReplyText("");
      setWaTemplateName("");
      setWaTemplateParams("");
      setSelectedTemplateId("");
      setWaReplyAttachments([]);
      await loadTicketDetail(ticketId);
      await loadDraftQueue();
    } else {
      const payload = await res.json().catch(() => ({}));
      setReplyError(payload.error ?? "Failed to send reply");
    }
    setSending(false);
  }

  async function resendWhatsApp(messageId: string) {
    setResendError(null);
    setResendingMessageId(messageId);
    const res = await fetch(`/api/messages/${messageId}/whatsapp-resend`, {
      method: "POST"
    });
    if (!res.ok) {
      const payload = await res.json().catch(() => ({}));
      setResendError(payload.error ?? "Failed to resend WhatsApp message");
      setResendingMessageId(null);
      return;
    }
    await loadMessageDetail(messageId);
    if (activeTicketId) {
      await loadTicketDetail(activeTicketId);
    }
    setResendingMessageId(null);
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
      await loadDraftQueue();
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
      await loadDraftQueue();
    }
  }

  async function sendQueueDraft(draft: DraftQueueItem, skipRefresh = false) {
    setDraftQueueError(null);
    setDraftQueueActionId(draft.id);
    const res = await fetch(`/api/tickets/${draft.ticket_id}/drafts/${draft.id}/send`, {
      method: "POST"
    });
    if (!res.ok) {
      const payload = await res.json().catch(() => ({}));
      setDraftQueueError(payload.error ?? "Failed to send draft.");
      setDraftQueueActionId(null);
      return false;
    }
    if (activeTicketId === draft.ticket_id) {
      await loadTicketDetail(draft.ticket_id);
    }
    if (!skipRefresh) {
      await loadDraftQueue();
    }
    setDraftQueueActionId(null);
    return true;
  }

  async function dismissQueueDraft(draft: DraftQueueItem, skipRefresh = false) {
    setDraftQueueError(null);
    setDraftQueueActionId(draft.id);
    const res = await fetch(`/api/tickets/${draft.ticket_id}/drafts/${draft.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "dismissed" })
    });
    if (!res.ok) {
      const payload = await res.json().catch(() => ({}));
      setDraftQueueError(payload.error ?? "Failed to dismiss draft.");
      setDraftQueueActionId(null);
      return false;
    }
    if (activeTicketId === draft.ticket_id) {
      await loadTicketDetail(draft.ticket_id);
    }
    if (!skipRefresh) {
      await loadDraftQueue();
    }
    setDraftQueueActionId(null);
    return true;
  }

  async function bulkQueueAction(action: "send" | "dismiss") {
    if (draftQueueSelectedIds.length === 0) return;
    setDraftQueueError(null);
    setDraftQueueBulkAction(action);
    let failed = 0;
    for (const draftId of draftQueueSelectedIds) {
      const draft = draftQueue.find((item) => item.id === draftId);
      if (!draft) continue;
      const ok =
        action === "send"
          ? await sendQueueDraft(draft, true)
          : await dismissQueueDraft(draft, true);
      if (!ok) {
        failed += 1;
      }
    }
    await loadDraftQueue();
    if (failed > 0) {
      setDraftQueueError(`Failed to ${action} ${failed} draft(s).`);
    } else {
      setDraftQueueSelectedIds([]);
    }
    setDraftQueueBulkAction(null);
  }

  const activeTicket = tickets.find((ticket) => ticket.id === activeTicketId) ?? null;
  const ticketChannel = messages.some((message) => message.channel === "whatsapp")
    ? "whatsapp"
    : "email";
  const whatsappContact =
    activeTicket && activeTicket.requester_email.startsWith("whatsapp:")
      ? activeTicket.requester_email.replace(/^whatsapp:/, "")
      : null;
  const whatsappContactLink = whatsappContact ? `https://wa.me/${whatsappContact}` : null;
  const activeTemplates = whatsappTemplates.filter((template) => template.status === "active");
  const selectedTemplate =
    whatsappTemplates.find((template) => template.id === selectedTemplateId) ?? null;
  const selectedTemplateParamCount = getTemplateParamCount(selectedTemplate);
  const templateParamList = waTemplateParams
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const missingTemplateParams = selectedTemplateParamCount
    ? Math.max(0, selectedTemplateParamCount - templateParamList.length)
    : 0;
  const normalizedMacroQuery = macroQuery.trim().toLowerCase();
  const quickMacros = (normalizedMacroQuery
    ? macros.filter((macro) =>
        `${macro.title} ${macro.body}`.toLowerCase().includes(normalizedMacroQuery)
      )
    : macros
  ).slice(0, 6);
  const availableTags = Array.from(
    new Set(tickets.flatMap((ticket) => ticket.tags ?? []))
  )
    .map((tag) => tag.toLowerCase())
    .filter((tag) => !(activeTicket?.tags ?? []).includes(tag));
  const templateParamPreview = (() => {
    if (!selectedTemplate) {
      return [];
    }
    const requiredCount = selectedTemplateParamCount ?? templateParamList.length;
    const totalCount = Math.max(requiredCount, templateParamList.length);
    if (totalCount === 0) {
      return [];
    }
    return Array.from({ length: totalCount }, (_value, index) => {
      const value = templateParamList[index] ?? "";
      const isMissing = !value && index < requiredCount;
      return { index: index + 1, value, isMissing };
    });
  })();
  const whatsappPreviewPayload =
    ticketChannel === "whatsapp"
      ? selectedTemplate
        ? {
            type: "template",
            name: selectedTemplate.name,
            language: selectedTemplate.language,
            parameters: templateParamList
          }
        : replyText.trim()
          ? {
              type: "text",
              body: replyText.trim()
            }
          : null
      : null;
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
  const draftQueueSelectedAll =
    draftQueue.length > 0 && draftQueueSelectedIds.length === draftQueue.length;

  useEffect(() => {
    if (!waContactCopyStatus) return;
    const timer = setTimeout(() => setWaContactCopyStatus(null), 2000);
    return () => clearTimeout(timer);
  }, [waContactCopyStatus]);
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
          <aside className="panel tickets-sidebar" data-density={ticketDensity}>
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
              <div className="ticket-filter-chips">
                <span className="ticket-filter-label">Channel</span>
                <div className="ticket-filter-chip-row">
                  {[
                    { value: "all", label: "All" },
                    { value: "email", label: "Email" },
                    { value: "whatsapp", label: "WhatsApp" }
                  ].map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setFilterChannel(option.value)}
                      className={`ticket-filter-chip${
                        filterChannel === option.value ? " active" : ""
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
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
              <label>
                Density
                <select
                  value={ticketDensity}
                  onChange={(event) =>
                    setTicketDensity(event.target.value as "comfortable" | "compact")
                  }
                >
                  <option value="comfortable">Comfortable</option>
                  <option value="compact">Compact</option>
                </select>
              </label>
              <div style={{ fontSize: 12, color: "var(--muted)" }}>
                Shortcuts: <code>j</code>/<code>k</code> to move · <code>r</code> to reply ·{" "}
                <code>shift</code> + click to range select
              </div>
            </div>
            <div className="tickets-bulk-bar">
              <label className="tickets-select-all">
                <input
                  type="checkbox"
                  checked={tickets.length > 0 && selectedTicketIds.length === tickets.length}
                  onChange={(event) =>
                    setSelectedTicketIds(event.target.checked ? tickets.map((ticket) => ticket.id) : [])
                  }
                />
                Select all
              </label>
              {selectedTicketIds.length ? (
                <span className="tickets-selected-count">
                  {selectedTicketIds.length} selected
                </span>
              ) : null}
              {selectedTicketIds.length ? (
                <button
                  type="button"
                  onClick={() => setSelectedTicketIds([])}
                  className="tickets-clear-selection"
                >
                  Clear
                </button>
              ) : null}
            </div>
            {selectedTicketIds.length ? (
              <div className="tickets-bulk-actions">
                <div className="tickets-bulk-row">
                  <label>
                    Status
                    <select
                      value={bulkStatus}
                      onChange={(event) => setBulkStatus(event.target.value)}
                    >
                      <option value="">Choose status</option>
                      {STATUS_OPTIONS.map((status) => (
                        <option key={status} value={status}>
                          {status}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    disabled={!bulkStatus || bulkUpdating}
                    onClick={() => applyBulkUpdates({ status: bulkStatus })}
                  >
                    Apply
                  </button>
                </div>
                <div className="tickets-bulk-row">
                  <label>
                    Priority
                    <select
                      value={bulkPriority}
                      onChange={(event) => setBulkPriority(event.target.value)}
                    >
                      <option value="">Choose priority</option>
                      {["low", "normal", "high", "urgent"].map((priority) => (
                        <option key={priority} value={priority}>
                          {priority}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    disabled={!bulkPriority || bulkUpdating}
                    onClick={() => applyBulkUpdates({ priority: bulkPriority })}
                  >
                    Apply
                  </button>
                </div>
                <div className="tickets-bulk-row">
                  <label>
                    Add tags
                    <input
                      type="text"
                      placeholder="billing, urgent"
                      value={bulkAddTags}
                      onChange={(event) => setBulkAddTags(event.target.value)}
                    />
                  </label>
                  <button
                    type="button"
                    disabled={!bulkAddTags.trim() || bulkUpdating}
                    onClick={() => applyBulkTags("add")}
                  >
                    Apply
                  </button>
                </div>
                <div className="tickets-bulk-row">
                  <label>
                    Remove tags
                    <input
                      type="text"
                      placeholder="general"
                      value={bulkRemoveTags}
                      onChange={(event) => setBulkRemoveTags(event.target.value)}
                    />
                  </label>
                  <button
                    type="button"
                    disabled={!bulkRemoveTags.trim() || bulkUpdating}
                    onClick={() => applyBulkTags("remove")}
                  >
                    Apply
                  </button>
                </div>
                <div className="tickets-bulk-quick">
                  <button
                    type="button"
                    disabled={bulkUpdating}
                    onClick={() => applyBulkUpdates({ status: "closed" })}
                  >
                    Close selected
                  </button>
                  <button
                    type="button"
                    disabled={bulkUpdating}
                    onClick={() => applyBulkUpdates({ status: "pending" })}
                  >
                    Snooze (pending)
                  </button>
                </div>
                {user?.role_name === "lead_admin" ? (
                  <button
                    type="button"
                    className="tickets-bulk-assign"
                    disabled={bulkUpdating}
                    onClick={() =>
                      user ? applyBulkUpdates({ assigned_user_id: user.id }) : null
                    }
                  >
                    Assign to me
                  </button>
                ) : null}
                {bulkError ? <span className="tickets-bulk-error">{bulkError}</span> : null}
              </div>
            ) : null}
            {tickets.length === 0 ? (
              <div className="ticket-empty">
                <h3>No tickets yet</h3>
                <p>Send an email to support or create a ticket manually.</p>
                <a href="/tickets/new" className="app-action">
                  Create ticket
                </a>
              </div>
            ) : (
              tickets.map((ticket) => {
                const isSelected = selectedTicketIds.includes(ticket.id);
                const channel = ticket.has_whatsapp ? "whatsapp" : "email";
                const requesterLabel = ticket.requester_email.startsWith("whatsapp:")
                  ? `WhatsApp ${ticket.requester_email.replace(/^whatsapp:/, "")}`
                  : ticket.requester_email;
                return (
                  <div key={ticket.id} className="ticket-card-row">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={(event) =>
                        handleTicketSelection(
                          ticket.id,
                          event.target.checked,
                          event.nativeEvent instanceof MouseEvent ? event.nativeEvent.shiftKey : false
                        )
                      }
                      className="ticket-card-checkbox"
                      aria-label="Select ticket"
                    />
                    <button
                      type="button"
                      onClick={() => setActiveTicketId(ticket.id)}
                      className={`ticket-card${ticket.id === activeTicketId ? " active" : ""}${
                        isSelected ? " selected" : ""
                      }`}
                    >
                      <div className="ticket-card-header">
                        <strong>{ticket.subject ?? "(no subject)"}</strong>
                        <span className={`ticket-channel-badge ${channel}`}>
                          {channel === "whatsapp" ? "WhatsApp" : "Email"}
                        </span>
                      </div>
                      <div style={{ fontSize: 12 }}>{requesterLabel}</div>
                      <div style={{ fontSize: 12 }}>Status: {ticket.status}</div>
                      {ticket.category ? (
                        <div style={{ fontSize: 12 }}>Category: {ticket.category}</div>
                      ) : null}
                      {ticket.tags && ticket.tags.length ? (
                        <div style={{ fontSize: 12 }}>Tags: {ticket.tags.join(", ")}</div>
                      ) : null}
                    </button>
                  </div>
                );
              })
            )}
          </aside>

          <section className="tickets-detail">
            <div className="tickets-detail-stack">
              <div className="panel draft-queue">
                <div className="draft-queue-header">
                  <div>
                    <h3 style={{ margin: 0 }}>AI Draft Queue</h3>
                    <p style={{ margin: "6px 0 0" }}>
                      {draftQueue.length} pending draft{draftQueue.length === 1 ? "" : "s"}
                    </p>
                  </div>
                  {draftQueueLoading ? <span className="draft-queue-status">Loading…</span> : null}
                </div>
                <div className="draft-queue-filters">
                  <label>
                    Search drafts
                    <input
                      type="text"
                      placeholder="Subject, requester, or draft text"
                      value={draftQueueQuery}
                      onChange={(event) => setDraftQueueQuery(event.target.value)}
                    />
                  </label>
                  <div className="ticket-filter-chips">
                    <span className="ticket-filter-label">Channel</span>
                    <div className="ticket-filter-chip-row">
                      {[
                        { value: "all", label: "All" },
                        { value: "email", label: "Email" },
                        { value: "whatsapp", label: "WhatsApp" }
                      ].map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => setDraftQueueChannel(option.value)}
                          className={`ticket-filter-chip${
                            draftQueueChannel === option.value ? " active" : ""
                          }`}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  {user?.role_name === "lead_admin" ? (
                    <label>
                      Assignment
                      <select
                        value={draftQueueAssigned}
                        onChange={(event) => setDraftQueueAssigned(event.target.value)}
                      >
                        <option value="all">All</option>
                        <option value="mine">My tickets</option>
                      </select>
                    </label>
                  ) : null}
                </div>
                {draftQueue.length ? (
                  <>
                    <div className="draft-queue-bulk">
                      <label className="tickets-select-all">
                        <input
                          type="checkbox"
                          checked={draftQueueSelectedAll}
                          onChange={(event) =>
                            setDraftQueueSelectedIds(
                              event.target.checked ? draftQueue.map((draft) => draft.id) : []
                            )
                          }
                        />
                        Select all
                      </label>
                      <div className="draft-queue-bulk-actions">
                        <button
                          type="button"
                          disabled={
                            draftQueueSelectedIds.length === 0 || draftQueueBulkAction === "send"
                          }
                          onClick={() => bulkQueueAction("send")}
                        >
                          {draftQueueBulkAction === "send" ? "Sending..." : "Approve & send"}
                        </button>
                        <button
                          type="button"
                          disabled={
                            draftQueueSelectedIds.length === 0 ||
                            draftQueueBulkAction === "dismiss"
                          }
                          onClick={() => bulkQueueAction("dismiss")}
                        >
                          {draftQueueBulkAction === "dismiss" ? "Dismissing..." : "Dismiss"}
                        </button>
                      </div>
                    </div>
                    <div className="draft-queue-list">
                      {draftQueue.map((draft) => {
                        const isSelected = draftQueueSelectedIds.includes(draft.id);
                        const channel = draft.has_whatsapp ? "whatsapp" : "email";
                        const requesterLabel = draft.requester_email.startsWith("whatsapp:")
                          ? `WhatsApp ${draft.requester_email.replace(/^whatsapp:/, "")}`
                          : draft.requester_email;
                        const preview = getDraftPlainText(draft);
                        return (
                          <div
                            key={draft.id}
                            className={`draft-queue-item${isSelected ? " selected" : ""}`}
                          >
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={(event) =>
                                setDraftQueueSelectedIds((prev) =>
                                  event.target.checked
                                    ? [...new Set([...prev, draft.id])]
                                    : prev.filter((id) => id !== draft.id)
                                )
                              }
                              aria-label="Select draft"
                            />
                            <div className="draft-queue-meta">
                              <div className="draft-queue-title">
                                <strong>{draft.ticket_subject ?? "(no subject)"}</strong>
                                <span className={`ticket-channel-badge ${channel}`}>
                                  {channel === "whatsapp" ? "WhatsApp" : "Email"}
                                </span>
                              </div>
                              <div className="draft-queue-sub">
                                {requesterLabel} · {new Date(draft.created_at).toLocaleString()}
                              </div>
                              {preview ? (
                                <div className="draft-queue-preview">{preview}</div>
                              ) : (
                                <div className="draft-queue-preview muted">No draft body.</div>
                              )}
                            </div>
                            <div className="draft-queue-actions">
                              <button
                                type="button"
                                onClick={() => setActiveTicketId(draft.ticket_id)}
                              >
                                Open ticket
                              </button>
                              <button
                                type="button"
                                onClick={() => sendQueueDraft(draft)}
                                disabled={draftQueueActionId === draft.id}
                              >
                                {draftQueueActionId === draft.id ? "Sending..." : "Approve & send"}
                              </button>
                              <button
                                type="button"
                                onClick={() => dismissQueueDraft(draft)}
                                disabled={draftQueueActionId === draft.id}
                              >
                                {draftQueueActionId === draft.id ? "Dismissing..." : "Dismiss"}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </>
                ) : (
                  <p className="draft-queue-empty">
                    No pending AI drafts. When the agent creates a draft, it will appear here.
                  </p>
                )}
                {draftQueueError ? <p className="draft-queue-error">{draftQueueError}</p> : null}
              </div>

              {!activeTicket ? (
                <div className="panel ticket-empty">
                  <h3>Select a ticket</h3>
                  <p>Choose a ticket on the left to see conversation, drafts, and activity.</p>
                </div>
              ) : (
                <>
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
                  {whatsappContact ? (
                    <div className="whatsapp-contact-actions">
                      <button
                        type="button"
                        onClick={() => {
                          if (!whatsappContact) return;
                          navigator.clipboard
                            .writeText(whatsappContact)
                            .then(() => setWaContactCopyStatus("Copied contact"))
                            .catch(() => setWaContactCopyStatus("Copy failed"));
                        }}
                      >
                        Copy number
                      </button>
                      {whatsappContactLink ? (
                        <a href={whatsappContactLink} target="_blank" rel="noreferrer">
                          Open WhatsApp
                        </a>
                      ) : null}
                      {waContactCopyStatus ? (
                        <span className="whatsapp-contact-status">{waContactCopyStatus}</span>
                      ) : null}
                    </div>
                  ) : null}
                  {activeTicket.category ? <p>Category: {activeTicket.category}</p> : null}
                  <div className="ticket-tags">
                    <div className="ticket-tags-header">
                      <strong>Tags</strong>
                      {activeTicket.tags && activeTicket.tags.length ? (
                        <span className="ticket-tags-count">
                          {activeTicket.tags.length} total
                        </span>
                      ) : null}
                    </div>
                    {activeTicket.tags && activeTicket.tags.length ? (
                      <div className="ticket-tags-list">
                        {activeTicket.tags.map((tag) => (
                          <span key={tag} className="ticket-tag-pill">
                            {tag}
                            <button
                              type="button"
                              onClick={() => updateTicketTags("remove", [tag])}
                              disabled={tagSaving}
                              aria-label={`Remove tag ${tag}`}
                            >
                              ×
                            </button>
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="ticket-tags-empty">No tags yet.</span>
                    )}
                    <div className="ticket-tags-actions">
                      <label>
                        Add tags
                        <input
                          type="text"
                          placeholder="billing, urgent"
                          value={tagInput}
                          onChange={(event) => {
                            setTagInput(event.target.value);
                            if (tagError) {
                              setTagError(null);
                            }
                          }}
                        />
                      </label>
                      <button
                        type="button"
                        onClick={() => updateTicketTags("add", parseTagList(tagInput))}
                        disabled={!tagInput.trim() || tagSaving}
                      >
                        Add
                      </button>
                    </div>
                    {availableTags.length ? (
                      <div className="ticket-tags-suggestions">
                        {availableTags.slice(0, 8).map((tag) => (
                          <button
                            key={tag}
                            type="button"
                            onClick={() => updateTicketTags("add", [tag])}
                            disabled={tagSaving}
                          >
                            {tag}
                          </button>
                        ))}
                      </div>
                    ) : null}
                    {tagError ? <span className="ticket-tags-error">{tagError}</span> : null}
                  </div>
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
                        messages.map((message, index) => {
                          const isOutbound = message.direction === "outbound";
                          const statusLabel = (message.wa_status ?? "queued").toLowerCase();
                          const statusClass = `status-${statusLabel}`;
                          const currentDate = getMessageDateKey(message);
                          const previousDate =
                            index > 0 ? getMessageDateKey(messages[index - 1]) : null;
                          const showDivider = currentDate !== previousDate;
                          const waAttachments = message.attachments ?? [];

                          return (
                            <div key={message.id} className="whatsapp-thread-row">
                              {showDivider ? (
                                <div className="whatsapp-date-divider">{currentDate}</div>
                              ) : null}
                              <button
                                type="button"
                                onClick={() => loadMessageDetail(message.id)}
                                className={`whatsapp-bubble ${isOutbound ? "outbound" : "inbound"}${
                                  message.id === activeMessageId ? " active" : ""
                                }`}
                              >
                                <div className="whatsapp-text">
                                  {message.preview_text ?? "(no message body)"}
                                </div>
                                {waAttachments.length ? (
                                  <div className="whatsapp-attachments">
                                    {waAttachments.map((attachment) => {
                                      const isImage = attachment.content_type?.startsWith("image/");
                                      const url = `/api/attachments/${attachment.id}`;
                                      return (
                                        <div key={attachment.id} className="whatsapp-attachment">
                                          {isImage ? (
                                            <Image
                                              src={url}
                                              alt={attachment.filename}
                                              width={240}
                                              height={160}
                                              unoptimized
                                              style={{ display: "block", width: "100%", height: "auto" }}
                                            />
                                          ) : (
                                            <a href={url} target="_blank" rel="noreferrer">
                                              {attachment.filename}
                                            </a>
                                          )}
                                        </div>
                                      );
                                    })}
                                  </div>
                                ) : null}
                                <div className="whatsapp-meta">
                                  <span>{formatMessageTimestamp(message)}</span>
                                  {isOutbound ? (
                                    <span className="whatsapp-status">
                                      <span className={`whatsapp-status-dot ${statusClass}`} />
                                      {message.wa_status ?? "queued"}
                                    </span>
                                  ) : null}
                                </div>
                              </button>
                            </div>
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
                            {(() => {
                              const events = messageDetail.statusEvents ?? [];
                              const latestStatus =
                                events.length > 0
                                  ? events[events.length - 1].status
                                  : messageDetail.waStatus ?? "queued";
                              const latestTimestamp =
                                events.length > 0
                                  ? events[events.length - 1].occurred_at
                                  : messageDetail.waTimestamp ?? null;
                              const isFailed = (latestStatus ?? "").toLowerCase() === "failed";
                              return (
                                <>
                                  <div style={{ fontSize: 12, color: "var(--muted)" }}>
                                    Status: {latestStatus ?? "—"} · Contact:{" "}
                                    {messageDetail.waContact ?? messageDetail.from}
                                  </div>
                                  {messageDetail.direction === "outbound" ? (
                                    <div className="wa-status-track">
                                      {WHATSAPP_STATUS_STEPS.map((step) => {
                                        const status = (latestStatus ?? "queued").toLowerCase();
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
                                        {latestTimestamp
                                          ? new Date(latestTimestamp).toLocaleString()
                                          : "—"}
                                      </span>
                                    </div>
                                  ) : null}
                                  {isFailed ? (
                                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                      <button
                                        type="button"
                                        onClick={() => resendWhatsApp(messageDetail.id)}
                                        disabled={resendingMessageId === messageDetail.id}
                                        style={{
                                          padding: "6px 10px",
                                          borderRadius: 8,
                                          border: "1px solid var(--border)",
                                          background: "var(--surface-2)",
                                          color: "var(--text)",
                                          cursor: "pointer"
                                        }}
                                      >
                                        {resendingMessageId === messageDetail.id
                                          ? "Resending..."
                                          : "Resend failed"}
                                      </button>
                                      {resendError ? (
                                        <span style={{ fontSize: 12, color: "var(--danger)" }}>
                                          {resendError}
                                        </span>
                                      ) : null}
                                    </div>
                                  ) : null}
                                  {events.length ? (
                                    <div className="wa-status-history">
                                      {events.map((event, index) => (
                                        <div key={`${event.status}-${index}`}>
                                          {event.status} ·{" "}
                                          {event.occurred_at
                                            ? new Date(event.occurred_at).toLocaleString()
                                            : "—"}
                                        </div>
                                      ))}
                                    </div>
                                  ) : null}
                                </>
                              );
                            })()}
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
                        const draftTemplateSummary = getDraftTemplateSummary(draft);

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
                            {draftTemplateSummary ? (
                              <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>
                                Template: {draftTemplateSummary.name}
                                {draftTemplateSummary.language
                                  ? ` (${draftTemplateSummary.language})`
                                  : ""}
                                {draftTemplateSummary.paramCount
                                  ? ` · ${draftTemplateSummary.paramCount} params`
                                  : ""}
                              </div>
                            ) : null}
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
                                {draft.body_text ??
                                  (draftTemplateSummary ? "Template-only draft." : "No draft body provided.")}
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
                  {macros.length ? (
                    <div className="quick-replies">
                      <div className="quick-replies-header">
                        <strong>Quick replies</strong>
                        <input
                          type="text"
                          placeholder="Search templates..."
                          value={macroQuery}
                          onChange={(event) => setMacroQuery(event.target.value)}
                        />
                      </div>
                      <div className="quick-replies-list">
                        {quickMacros.length ? (
                          quickMacros.map((macro) => (
                            <button
                              key={macro.id}
                              type="button"
                              onClick={() =>
                                setReplyText((prev) =>
                                  prev ? `${prev}\n\n${macro.body}` : macro.body
                                )
                              }
                              className="quick-reply-chip"
                            >
                              {macro.title}
                            </button>
                          ))
                        ) : (
                          <span className="quick-reply-empty">No templates found.</span>
                        )}
                      </div>
                    </div>
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
                    <div className="wa-attachments">
                      <label>
                        Attachment (1 max, 10MB)
                        <input type="file" onChange={handleWaAttachmentChange} />
                      </label>
                      {waReplyAttachments.length ? (
                        <div className="wa-attachments-list">
                          {waReplyAttachments.map((attachment) => (
                            <div key={attachment.id} className="wa-attachment-item">
                              <div>
                                <strong>{attachment.filename}</strong>
                                <div className="wa-attachment-meta">
                                  {(attachment.size / 1024 / 1024).toFixed(1)} MB
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={() => removeWaAttachment(attachment.id)}
                              >
                                Remove
                              </button>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
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
                  {whatsappPreviewPayload ? (
                    <div style={{ display: "grid", gap: 6 }}>
                      <strong style={{ fontSize: 12 }}>WhatsApp Payload Preview</strong>
                      {selectedTemplate ? (
                        <div className="wa-preview-meta">
                          <div>
                            Template {selectedTemplate.name} ({selectedTemplate.language})
                            {missingTemplateParams ? ` · Missing ${missingTemplateParams}` : ""}
                          </div>
                          <div className="wa-preview-params">
                            {templateParamPreview.length ? (
                              templateParamPreview.map((param) => (
                                <div
                                  key={`param-${param.index}`}
                                  className={`wa-preview-param${param.isMissing ? " missing" : ""}`}
                                >
                                  <span className="wa-preview-index">#{param.index}</span>
                                  <span>{param.value || "missing"}</span>
                                </div>
                              ))
                            ) : (
                              <div className="wa-preview-empty">No template parameters.</div>
                            )}
                          </div>
                        </div>
                      ) : null}
                      <pre className="wa-preview">
                        {JSON.stringify(whatsappPreviewPayload, null, 2)}
                      </pre>
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
                </>
            )}
            </div>
          </section>
        </div>
      </div>
    </AppShell>
  );
}
