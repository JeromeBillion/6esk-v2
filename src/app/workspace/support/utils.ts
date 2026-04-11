import {
  Check,
  CheckCheck,
  XCircle
} from "lucide-react";
import type { ApiTicket, ApiTicketEvent } from "@/app/lib/api/support";
import { getMessageDetail, getTicketDetails } from "@/app/lib/api/support";
import type { ActiveWhatsAppTemplate } from "@/app/lib/api/whatsapp";
import type { HistoryTicketEvent } from "../components/HistoryModal";
import type {
  ConversationMessage,
  ConversationTimelineItem,
  SavedViewFilters,
  TicketStatusDisplay,
  TicketView
} from "./types";
import {
  DISPLAY_STATUS_BY_API,
  DISPLAY_PRIORITY_BY_API,
  STATUS_FILTER_VALUES,
  PRIORITY_FILTER_VALUES,
  CHANNEL_FILTER_VALUES,
  ASSIGNED_FILTER_VALUES
} from "./types";
import type { TicketDetailsResponse } from "@/app/lib/api/support";

// ── General utilities ───────────────────────────────────────────

export function clampNumber(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
}

export function toTitleCase(value: string) {
  return value
    .replace(/[._-]+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function normalizeAddress(value: string) {
  if (value.startsWith("whatsapp:")) {
    return value.replace(/^whatsapp:/, "");
  }
  if (value.startsWith("voice:")) {
    return value.replace(/^voice:/, "");
  }
  return value;
}

export function deriveNameFromIdentity(value: string) {
  const normalized = normalizeAddress(value);
  if (normalized.includes("@")) {
    return toTitleCase(normalized.split("@")[0] ?? normalized);
  }
  return normalized;
}

export function stripHtml(value: string) {
  return value
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function formatDateRelative(dateString: string) {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function formatDuration(seconds: number) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export function normalizeRecipientEmail(value: string | null | undefined) {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  return normalized || null;
}

export function normalizeRecipientPhone(value: string | null | undefined) {
  if (!value) return null;
  const normalized = normalizeAddress(value).replace(/[^\d+]/g, "").trim();
  return normalized || null;
}

export function normalizeQueuePreviewValue(value: string | null | undefined) {
  return (value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

export function formatTicketDisplayId(ticketNumber: number | null | undefined, fallbackId: string) {
  if (typeof ticketNumber === "number" && Number.isFinite(ticketNumber)) {
    return `#${ticketNumber}`;
  }
  return fallbackId;
}

// ── Metadata helpers ────────────────────────────────────────────

export function readMetadataText(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

export function deriveCustomerAddress(
  customerAddress: string | null | undefined,
  metadata: Record<string, unknown> | null | undefined
) {
  if (typeof customerAddress === "string" && customerAddress.trim()) {
    return customerAddress.trim();
  }

  if (!metadata || typeof metadata !== "object") {
    return null;
  }

  const directMatch = readMetadataText(metadata, ["address", "streetAddress", "mailingAddress"]);
  if (directMatch) {
    return directMatch;
  }

  const addressRecord =
    metadata.address && typeof metadata.address === "object" && !Array.isArray(metadata.address)
      ? (metadata.address as Record<string, unknown>)
      : null;

  if (!addressRecord) {
    return null;
  }

  const lineOne = readMetadataText(addressRecord, ["line1", "street", "street1"]);
  const lineTwo = readMetadataText(addressRecord, ["line2", "suite", "street2"]);
  const locality = readMetadataText(addressRecord, ["city", "locality"]);
  const region = readMetadataText(addressRecord, ["state", "region", "province"]);
  const postalCode = readMetadataText(addressRecord, ["postalCode", "zip", "zipCode"]);
  const country = readMetadataText(addressRecord, ["country"]);

  const parts = [lineOne, lineTwo, locality, region, postalCode, country].filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

// ── WhatsApp helpers ────────────────────────────────────────────

export function getTemplateParamCount(template?: ActiveWhatsAppTemplate | null) {
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

export function whatsappStatusIcon(status: string | null | undefined) {
  switch ((status ?? "").toLowerCase()) {
    case "sent":
      return Check;
    case "delivered":
      return CheckCheck;
    case "read":
      return CheckCheck;
    case "failed":
      return XCircle;
    default:
      return null;
  }
}

export function whatsappStatusIconColor(status: string | null | undefined) {
  switch ((status ?? "").toLowerCase()) {
    case "sent":
      return "w-3 h-3 text-neutral-400";
    case "delivered":
      return "w-3 h-3 text-neutral-400";
    case "read":
      return "w-3 h-3 text-blue-500";
    case "failed":
      return "w-3 h-3 text-red-500";
    default:
      return "";
  }
}

// ── Ticket mapping ──────────────────────────────────────────────

export function mapTicket(ticket: ApiTicket): TicketView {
  const requesterEmail = normalizeAddress(ticket.requester_email);
  const subject = ticket.subject ?? "(no subject)";
  return {
    id: ticket.id,
    ticket_number: ticket.ticket_number,
    requester_email: requesterEmail,
    requester_name: deriveNameFromIdentity(requesterEmail),
    subject,
    category: ticket.category,
    metadata: ticket.metadata,
    tags: ticket.tags ?? [],
    status: DISPLAY_STATUS_BY_API[ticket.status],
    priority: DISPLAY_PRIORITY_BY_API[ticket.priority],
    assigned_user_id: ticket.assigned_user_id,
    assigned_user_name: null,
    has_whatsapp: Boolean(ticket.has_whatsapp),
    has_voice: Boolean(ticket.has_voice),
    created_at: ticket.created_at,
    updated_at: ticket.updated_at,
    preview: null,
    unread: false
  };
}

export function mapHistoryStatus(status: string): TicketStatusDisplay {
  if (status === "solved") return "resolved";
  if (status === "closed") return "closed";
  if (status === "pending") return "pending";
  return "open";
}

export function inferPrimaryChannel(ticket: TicketView, messages: ConversationMessage[]) {
  const inbound = messages.find((message) => message.direction === "inbound");
  if (inbound) return inbound.channel;
  if (ticket.has_whatsapp && !ticket.has_voice) return "whatsapp";
  if (ticket.has_voice && !ticket.has_whatsapp) return "voice";
  return messages[0]?.channel ?? "email";
}

// ── Saved view helpers ──────────────────────────────────────────

export function normalizeSavedViewFilters(filters?: SavedViewFilters) {
  return {
    status: STATUS_FILTER_VALUES.has(filters?.status ?? "") ? (filters?.status ?? "all") : "all",
    priority: PRIORITY_FILTER_VALUES.has(filters?.priority ?? "")
      ? (filters?.priority ?? "all")
      : "all",
    channel: CHANNEL_FILTER_VALUES.has(filters?.channel ?? "")
      ? (filters?.channel ?? "all")
      : "all",
    tag: filters?.tag?.trim() || "all",
    assigned: ASSIGNED_FILTER_VALUES.has(filters?.assigned ?? "")
      ? (filters?.assigned ?? "mine")
      : "mine",
    query: filters?.query?.trim() ?? ""
  };
}

export function areSavedViewFiltersEqual(left: SavedViewFilters | undefined, right: SavedViewFilters | undefined) {
  const leftNormalized = normalizeSavedViewFilters(left);
  const rightNormalized = normalizeSavedViewFilters(right);
  return (
    leftNormalized.status === rightNormalized.status &&
    leftNormalized.priority === rightNormalized.priority &&
    leftNormalized.channel === rightNormalized.channel &&
    leftNormalized.tag === rightNormalized.tag &&
    leftNormalized.assigned === rightNormalized.assigned &&
    leftNormalized.query === rightNormalized.query
  );
}

// ── Timeline builders ───────────────────────────────────────────

function normalizeEmailThreadKey(message: ConversationMessage) {
  if (message.channel !== "email") return null;
  const ticketPrefix = `${message.ticketId}::`;
  if (message.threadId?.trim()) {
    return `${ticketPrefix}${message.threadId.trim()}`;
  }
  if (message.subject?.trim()) {
    return `${ticketPrefix}${message.subject.replace(/^re:\s*/i, "").trim().toLowerCase()}`;
  }
  return `${ticketPrefix}email:${message.id}`;
}

export function buildConversationTimeline(messages: ConversationMessage[]): ConversationTimelineItem[] {
  const items: ConversationTimelineItem[] = [];
  let pendingEmailGroup:
    | {
        id: string;
        messages: ConversationMessage[];
      }
    | null = null;

  const flushEmailGroup = () => {
    if (!pendingEmailGroup) return;
    items.push({
      kind: "email-thread",
      id: `email-thread:${pendingEmailGroup.id}:${pendingEmailGroup.messages[0]?.id ?? "unknown"}`,
      ticketId: pendingEmailGroup.messages[0]?.ticketId ?? "",
      channel: "email",
      messages: pendingEmailGroup.messages
    });
    pendingEmailGroup = null;
  };

  for (const message of messages) {
    if (message.channel !== "email") {
      flushEmailGroup();
      items.push({
        kind: "message",
        id: message.id,
        ticketId: message.ticketId,
        channel: message.channel,
        message
      });
      continue;
    }

    const threadKey = normalizeEmailThreadKey(message);
    if (!pendingEmailGroup || pendingEmailGroup.id !== threadKey) {
      flushEmailGroup();
      pendingEmailGroup = {
        id: threadKey ?? `email:${message.id}`,
        messages: [message]
      };
      continue;
    }

    pendingEmailGroup.messages.push(message);
  }

  flushEmailGroup();
  return items;
}

export async function buildConversationMessages(
  details: TicketDetailsResponse,
  signal?: AbortSignal
): Promise<ConversationMessage[]> {
  const detailRows = await Promise.all(
    details.messages.map(async (message) => {
      try {
        return await getMessageDetail(message.id, signal);
      } catch {
        return null;
      }
    })
  );
  const messageDetailById = new Map(
    detailRows.filter(Boolean).map((row) => [row!.message.id, row!])
  );

  return details.messages
    .map((message) => {
      const messageDetail = messageDetailById.get(message.id);
      const body =
        messageDetail?.message.text ??
        (messageDetail?.message.html ? stripHtml(messageDetail.message.html) : null) ??
        message.preview_text ??
        "";
      const fromValue = messageDetail?.message.from ?? normalizeAddress(message.from_email);
      const toValue = messageDetail?.message.to?.[0] ?? message.to_emails?.[0] ?? "support@6esk.com";
      return {
        id: message.id,
        ticketId: details.ticket.id,
        channel: message.channel,
        threadId: messageDetail?.message.conversationId ?? null,
        direction: message.direction,
        subject: message.subject,
        from: {
          name: deriveNameFromIdentity(fromValue),
          email: fromValue.includes("@") ? fromValue : undefined,
          phone: fromValue.includes("@") ? undefined : fromValue
        },
        to: {
          name: deriveNameFromIdentity(toValue),
          email: toValue.includes("@") ? toValue : undefined,
          phone: toValue.includes("@") ? undefined : toValue
        },
        body,
        timestamp:
          messageDetail?.message.sentAt ??
          messageDetail?.message.receivedAt ??
          message.sent_at ??
          message.received_at ??
          new Date().toISOString(),
        whatsapp_status: messageDetail?.message.waStatus ?? message.wa_status ?? null,
        is_template: Boolean(
          messageDetail?.message.aiMeta &&
            (messageDetail.message.aiMeta.template || messageDetail.message.aiMeta.template_name)
        ),
        attachments: (messageDetail?.attachments ?? []).map((attachment) => ({
          id: attachment.id,
          filename: attachment.filename,
          contentType: attachment.content_type,
          sizeBytes: attachment.size_bytes
        })),
        call_duration: messageDetail?.message.callSession?.durationSeconds ?? undefined,
        call_status: messageDetail?.message.callSession?.status ?? null,
        call_outcome:
          messageDetail?.message.statusEvents?.slice(-1)[0]?.status && messageDetail?.message.callSession
            ? toTitleCase(messageDetail.message.statusEvents.slice(-1)[0]?.status ?? "")
            : null,
        transcript: messageDetail?.message.transcript?.text ?? null,
        recording_url: messageDetail?.message.callSession?.recordingUrl ?? null
      } satisfies ConversationMessage;
    })
    .sort((left, right) => new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime());
}

// ── Event mapping ───────────────────────────────────────────────

export function mapTicketEvent(event: ApiTicketEvent): HistoryTicketEvent {
  const payload = event.data ?? {};
  const actor = event.actor_user_id ? `User ${event.actor_user_id.slice(0, 8)}` : "System";
  if (event.event_type === "status_updated") {
    return {
      id: event.id,
      type: "status_change",
      actor,
      timestamp: event.created_at,
      details: `Status changed to ${toTitleCase(String(payload.to ?? "unknown"))}`,
      metadata: payload
    };
  }
  if (event.event_type === "assignment_updated") {
    return {
      id: event.id,
      type: "assignment",
      actor,
      timestamp: event.created_at,
      details: "Assignment updated",
      metadata: payload
    };
  }
  if (event.event_type === "priority_updated") {
    return {
      id: event.id,
      type: "priority_change",
      actor,
      timestamp: event.created_at,
      details: `Priority changed to ${toTitleCase(String(payload.to ?? "unknown"))}`,
      metadata: payload
    };
  }
  return {
    id: event.id,
    type: "note_added",
    actor,
    timestamp: event.created_at,
    details: toTitleCase(event.event_type),
    metadata: payload
  };
}

// ── Pane storage helpers ────────────────────────────────────────

export function readStoredPaneSize(storageKey: string, fallback: number) {
  if (typeof window === "undefined") {
    return fallback;
  }
  const raw = window.localStorage.getItem(storageKey);
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

// ── Color helpers ───────────────────────────────────────────────

export function getPriorityColor(priority: string) {
  switch (priority) {
    case "urgent":
      return "bg-red-100 text-red-700 border-red-200";
    case "high":
      return "bg-orange-100 text-orange-700 border-orange-200";
    case "medium":
      return "bg-blue-100 text-blue-700 border-blue-200";
    case "low":
      return "bg-neutral-100 text-neutral-700 border-neutral-200";
    default:
      return "bg-neutral-100 text-neutral-700 border-neutral-200";
  }
}

export function getStatusColor(status: string) {
  switch (status) {
    case "open":
      return "bg-green-100 text-green-700 border-green-200";
    case "pending":
      return "bg-yellow-100 text-yellow-700 border-yellow-200";
    case "resolved":
      return "bg-blue-100 text-blue-700 border-blue-200";
    case "closed":
      return "bg-neutral-100 text-neutral-700 border-neutral-200";
    default:
      return "bg-neutral-100 text-neutral-700 border-neutral-200";
  }
}
