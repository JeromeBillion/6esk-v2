import type { ApiTicket, SupportSavedView, TicketDetailsResponse } from "@/app/lib/api/support";
import type { HistoryAuditEvent, HistoryTicketEvent } from "../components/HistoryModal";

// ── Display enums ─────────────────────────────────────────────
export type TicketStatusDisplay = "open" | "pending" | "resolved" | "closed";
export type TicketPriorityDisplay = "low" | "medium" | "high" | "urgent";

// ── View models ───────────────────────────────────────────────
export type TicketView = {
  id: string;
  ticket_number: number;
  requester_email: string;
  requester_name: string;
  subject: string;
  category: string | null;
  metadata: Record<string, unknown> | null;
  tags: string[];
  status: TicketStatusDisplay;
  priority: TicketPriorityDisplay;
  assigned_user_id: string | null;
  assigned_user_name: string | null;
  has_whatsapp: boolean;
  has_voice: boolean;
  created_at: string;
  updated_at: string;
  preview: string | null;
  unread: boolean;
};

export type ConversationMessage = {
  id: string;
  ticketId: string;
  channel: "email" | "whatsapp" | "voice";
  threadId?: string | null;
  direction: "inbound" | "outbound";
  from: { name: string; email?: string; phone?: string };
  to: { name: string; email?: string; phone?: string };
  body: string;
  subject?: string | null;
  timestamp: string;
  whatsapp_status?: string | null;
  is_template?: boolean;
  attachments?: Array<{
    id: string;
    filename: string;
    contentType: string | null;
    sizeBytes: number | null;
  }>;
  call_duration?: number;
  call_status?: string | null;
  call_outcome?: string | null;
  transcript?: string | null;
  recording_url?: string | null;
};

export type ReplyAttachment = {
  id: string;
  filename: string;
  contentType: string | null;
  size: number;
  contentBase64: string;
};

export type ReplyRecipientOption = {
  value: string;
  label: string;
  isPrimary: boolean;
};

export type WhatsAppWindowState = {
  isOpen: boolean;
  minutesRemaining: number;
};

export type DraftView = {
  id: string;
  suggested_body: string;
  confidence: number | null;
};

export type CustomerTicketHistoryItem = {
  ticketId: string;
  ticketDisplayId: string;
  subject: string;
  status: TicketStatusDisplay;
  channel: "email" | "whatsapp" | "voice";
  lastActivityAt: string;
  lastCustomerInboundAt: string | null;
};

export type LinkedCaseHistoryItem = {
  linkId: string;
  ticketId: string;
  ticketDisplayId: string;
  customerId: string | null;
  subject: string;
  status: TicketStatusDisplay;
  priority: TicketPriorityDisplay;
  channel: "email" | "whatsapp" | "voice";
  requesterEmail: string;
  linkedAt: string;
  reason: string | null;
};

export type CustomerProfileView = {
  id: string;
  kind: "registered" | "unregistered";
  displayName: string | null;
  primaryEmail: string | null;
  primaryPhone: string | null;
  address?: string | null;
  identities: Array<{
    type: "email" | "phone";
    value: string;
    isPrimary: boolean;
  }>;
};

export type FeedbackState = {
  open: boolean;
  tone: "success" | "error" | "info";
  title: string;
  message: string;
  autoCloseMs?: number;
};

export type SavedViewFilters = SupportSavedView["filters"];

export type ConversationTimelineItem =
  | {
      kind: "email-thread";
      id: string;
      ticketId: string;
      channel: "email";
      messages: ConversationMessage[];
    }
  | {
      kind: "message";
      id: string;
      ticketId: string;
      channel: ConversationMessage["channel"];
      message: ConversationMessage;
    };

// ── Lookup maps ───────────────────────────────────────────────
export const DISPLAY_STATUS_BY_API: Record<ApiTicket["status"], TicketStatusDisplay> = {
  new: "open",
  open: "open",
  pending: "pending",
  solved: "resolved",
  closed: "closed"
};

export const API_STATUS_BY_DISPLAY: Record<TicketStatusDisplay, ApiTicket["status"]> = {
  open: "open",
  pending: "pending",
  resolved: "solved",
  closed: "closed"
};

export const DISPLAY_PRIORITY_BY_API: Record<ApiTicket["priority"], TicketPriorityDisplay> = {
  low: "low",
  normal: "medium",
  high: "high",
  urgent: "urgent"
};

export const API_PRIORITY_BY_DISPLAY: Record<TicketPriorityDisplay, ApiTicket["priority"]> = {
  low: "low",
  medium: "normal",
  high: "high",
  urgent: "urgent"
};

// ── Filter constants ──────────────────────────────────────────
export const STATUS_FILTER_VALUES = new Set(["all", "open", "pending", "resolved", "closed"]);
export const PRIORITY_FILTER_VALUES = new Set(["all", "low", "medium", "high", "urgent"]);
export const CHANNEL_FILTER_VALUES = new Set(["all", "email", "whatsapp", "voice"]);
export const ASSIGNED_FILTER_VALUES = new Set(["mine", "any"]);

// ── Pane layout constants ─────────────────────────────────────
export const SUPPORT_QUEUE_WIDTH_STORAGE_KEY = "sixesk:support:queue-width";
export const SUPPORT_DETAIL_SIDEBAR_WIDTH_STORAGE_KEY = "sixesk:support:detail-sidebar-width";
export const SUPPORT_COMPOSER_HEIGHT_STORAGE_KEY = "sixesk:support:composer-height";
export const SUPPORT_QUEUE_WIDTH_DEFAULT = 480;
export const SUPPORT_DETAIL_SIDEBAR_WIDTH_DEFAULT = 320;
export const SUPPORT_COMPOSER_HEIGHT_DEFAULT = 240;
export const SUPPORT_QUEUE_WIDTH_MIN = 360;
export const SUPPORT_QUEUE_WIDTH_MAX = 680;
export const SUPPORT_DETAIL_SIDEBAR_WIDTH_MIN = 280;
export const SUPPORT_DETAIL_SIDEBAR_WIDTH_MAX = 440;
export const SUPPORT_COMPOSER_HEIGHT_MIN = 180;
export const SUPPORT_COMPOSER_HEIGHT_MAX = 420;
