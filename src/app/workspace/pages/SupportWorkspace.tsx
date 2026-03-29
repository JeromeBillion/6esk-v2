import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type PointerEvent as ReactPointerEvent
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Search,
  Filter,
  Plus,
  Mail,
  ChevronDown,
  Clock,
  Phone,
  PhoneCall,
  Play,
  Check,
  CheckCheck,
  XCircle,
  Sparkles,
  GitMerge,
  Paperclip,
  RefreshCw,
  Save,
  Tag,
  Upload,
  UserRound,
  X
} from "lucide-react";
import { Input } from "../components/ui/input";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Separator } from "../components/ui/separator";
import { Textarea } from "../components/ui/textarea";
import { cn } from "../components/ui/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "../components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "../components/ui/dialog";
import { Checkbox } from "../components/ui/checkbox";
import {
  HistoryModal,
  type HistoryAuditEvent,
  type HistoryTicketEvent
} from "../components/HistoryModal";
import { MergeModal } from "../components/MergeModal";
import { ActionFeedbackModal } from "../components/ActionFeedbackModal";
import { MacroPickerModal } from "../components/MacroPickerModal";
import { VoiceCallModal } from "../components/VoiceCallModal";
import {
  ApiTicket,
  ApiTicketEvent,
  getMessageDetail,
  getTicketCallOptions,
  getTicketCustomerHistory,
  getTicketDetails,
  createBulkEmailTickets,
  createSupportSavedView,
  deleteSupportSavedView,
  listTickets,
  listSupportMacros,
  listSupportSavedViews,
  patchCustomerProfile,
  patchTicketsBulk,
  patchTicket,
  patchTicketDraft,
  patchTicketTags,
  queueOutboundCall,
  resendWhatsAppMessage,
  sendTicketReply,
  type TicketDetailsResponse,
  type SupportSavedView,
  type SupportMacro,
  type TicketCallOptions
} from "@/app/lib/api/support";
import { listActiveWhatsAppTemplates, type ActiveWhatsAppTemplate } from "@/app/lib/api/whatsapp";
import { getCurrentSessionUser, type CurrentSessionUser } from "@/app/lib/api/session";
import { listTags, listUsers, type AdminUserRecord, type TagRecord } from "@/app/lib/api/admin";
import { useDemoMode } from "@/app/lib/demo-mode";
import { encodeAttachments, formatFileSize } from "@/app/lib/files";
import { isAbortError } from "@/app/lib/api/http";

type TicketStatusDisplay = "open" | "pending" | "resolved" | "closed";
type TicketPriorityDisplay = "low" | "medium" | "high" | "urgent";

type TicketView = {
  id: string;
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

type ConversationMessage = {
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

type ReplyAttachment = {
  id: string;
  filename: string;
  contentType: string | null;
  size: number;
  contentBase64: string;
};

type ReplyRecipientOption = {
  value: string;
  label: string;
  isPrimary: boolean;
};

type WhatsAppWindowState = {
  isOpen: boolean;
  minutesRemaining: number;
};

type DraftView = {
  id: string;
  suggested_body: string;
  confidence: number | null;
};

type CustomerTicketHistoryItem = {
  ticketId: string;
  subject: string;
  status: TicketStatusDisplay;
  channel: "email" | "whatsapp" | "voice";
  lastActivityAt: string;
  lastCustomerInboundAt: string | null;
};

type LinkedCaseHistoryItem = {
  linkId: string;
  ticketId: string;
  customerId: string | null;
  subject: string;
  status: TicketStatusDisplay;
  priority: TicketPriorityDisplay;
  channel: "email" | "whatsapp" | "voice";
  requesterEmail: string;
  linkedAt: string;
  reason: string | null;
};

type CustomerProfileView = {
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

type FeedbackState = {
  open: boolean;
  tone: "success" | "error" | "info";
  title: string;
  message: string;
  autoCloseMs?: number;
};

const DISPLAY_STATUS_BY_API: Record<ApiTicket["status"], TicketStatusDisplay> = {
  new: "open",
  open: "open",
  pending: "pending",
  solved: "resolved",
  closed: "closed"
};

const API_STATUS_BY_DISPLAY: Record<TicketStatusDisplay, ApiTicket["status"]> = {
  open: "open",
  pending: "pending",
  resolved: "solved",
  closed: "closed"
};

const DISPLAY_PRIORITY_BY_API: Record<ApiTicket["priority"], TicketPriorityDisplay> = {
  low: "low",
  normal: "medium",
  high: "high",
  urgent: "urgent"
};

const API_PRIORITY_BY_DISPLAY: Record<TicketPriorityDisplay, ApiTicket["priority"]> = {
  low: "low",
  medium: "normal",
  high: "high",
  urgent: "urgent"
};

const STATUS_FILTER_VALUES = new Set(["all", "open", "pending", "resolved", "closed"]);
const PRIORITY_FILTER_VALUES = new Set(["all", "low", "medium", "high", "urgent"]);
const CHANNEL_FILTER_VALUES = new Set(["all", "email", "whatsapp", "voice"]);
const ASSIGNED_FILTER_VALUES = new Set(["mine", "any"]);
const SUPPORT_QUEUE_WIDTH_STORAGE_KEY = "sixesk:support:queue-width";
const SUPPORT_DETAIL_SIDEBAR_WIDTH_STORAGE_KEY = "sixesk:support:detail-sidebar-width";
const SUPPORT_COMPOSER_HEIGHT_STORAGE_KEY = "sixesk:support:composer-height";
const SUPPORT_QUEUE_WIDTH_DEFAULT = 480;
const SUPPORT_DETAIL_SIDEBAR_WIDTH_DEFAULT = 320;
const SUPPORT_COMPOSER_HEIGHT_DEFAULT = 240;
const SUPPORT_QUEUE_WIDTH_MIN = 360;
const SUPPORT_QUEUE_WIDTH_MAX = 680;
const SUPPORT_DETAIL_SIDEBAR_WIDTH_MIN = 280;
const SUPPORT_DETAIL_SIDEBAR_WIDTH_MAX = 440;
const SUPPORT_COMPOSER_HEIGHT_MIN = 180;
const SUPPORT_COMPOSER_HEIGHT_MAX = 420;

type SavedViewFilters = SupportSavedView["filters"];

function clampNumber(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
}

function readStoredPaneSize(storageKey: string, fallback: number) {
  if (typeof window === "undefined") {
    return fallback;
  }
  const raw = window.localStorage.getItem(storageKey);
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function usePersistentPaneSize(storageKey: string, fallback: number) {
  const [value, setValue] = useState(fallback);
  const hydratedRef = useRef(false);

  useEffect(() => {
    const storedValue = readStoredPaneSize(storageKey, fallback);
    setValue(storedValue);
    hydratedRef.current = true;
  }, [fallback, storageKey]);

  useEffect(() => {
    if (typeof window === "undefined" || !hydratedRef.current) {
      return;
    }
    window.localStorage.setItem(storageKey, String(Math.round(value)));
  }, [storageKey, value]);

  return [value, setValue] as const;
}

function startPointerResize(
  event: ReactPointerEvent<HTMLElement>,
  options: {
    cursor: "col-resize" | "row-resize";
    onMove: (deltaX: number, deltaY: number) => void;
  }
) {
  event.preventDefault();

  const startX = event.clientX;
  const startY = event.clientY;
  const previousUserSelect = document.body.style.userSelect;
  const previousCursor = document.body.style.cursor;

  document.body.style.userSelect = "none";
  document.body.style.cursor = options.cursor;

  const handlePointerMove = (moveEvent: PointerEvent) => {
    options.onMove(moveEvent.clientX - startX, moveEvent.clientY - startY);
  };

  const cleanup = () => {
    document.body.style.userSelect = previousUserSelect;
    document.body.style.cursor = previousCursor;
    window.removeEventListener("pointermove", handlePointerMove);
    window.removeEventListener("pointerup", cleanup);
    window.removeEventListener("pointercancel", cleanup);
  };

  window.addEventListener("pointermove", handlePointerMove);
  window.addEventListener("pointerup", cleanup);
  window.addEventListener("pointercancel", cleanup);
}

function ResizeHandle({
  orientation,
  onPointerDown
}: {
  orientation: "vertical" | "horizontal";
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
}) {
  const isVertical = orientation === "vertical";

  return (
    <div
      role="separator"
      aria-orientation={orientation}
      onPointerDown={onPointerDown}
      className={cn(
        "group relative shrink-0 touch-none select-none bg-transparent",
        isVertical ? "h-full w-2 cursor-col-resize" : "h-2 w-full cursor-row-resize"
      )}
    >
      <div
        className={cn(
          "absolute rounded-full bg-neutral-200 transition-colors group-hover:bg-blue-300 group-active:bg-blue-400",
          isVertical ? "bottom-0 left-1/2 top-0 w-px -translate-x-1/2" : "left-0 right-0 top-1/2 h-px -translate-y-1/2"
        )}
      />
    </div>
  );
}

function normalizeSavedViewFilters(filters?: SavedViewFilters) {
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

function areSavedViewFiltersEqual(left: SavedViewFilters | undefined, right: SavedViewFilters | undefined) {
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

function toTitleCase(value: string) {
  return value
    .replace(/[._-]+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function normalizeAddress(value: string) {
  if (value.startsWith("whatsapp:")) {
    return value.replace(/^whatsapp:/, "");
  }
  if (value.startsWith("voice:")) {
    return value.replace(/^voice:/, "");
  }
  return value;
}

function readMetadataText(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function deriveCustomerAddress(
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

function deriveNameFromIdentity(value: string) {
  const normalized = normalizeAddress(value);
  if (normalized.includes("@")) {
    return toTitleCase(normalized.split("@")[0] ?? normalized);
  }
  return normalized;
}

function stripHtml(value: string) {
  return value
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function formatDateRelative(dateString: string) {
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

function formatDuration(seconds: number) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function normalizeRecipientEmail(value: string | null | undefined) {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  return normalized || null;
}

function normalizeRecipientPhone(value: string | null | undefined) {
  if (!value) return null;
  const normalized = normalizeAddress(value).replace(/[^\d+]/g, "").trim();
  return normalized || null;
}

function getTemplateParamCount(template?: ActiveWhatsAppTemplate | null) {
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

function whatsappStatusIcon(status: string | null | undefined) {
  switch ((status ?? "").toLowerCase()) {
    case "sent":
      return <Check className="w-3 h-3 text-neutral-400" />;
    case "delivered":
      return <CheckCheck className="w-3 h-3 text-neutral-400" />;
    case "read":
      return <CheckCheck className="w-3 h-3 text-blue-500" />;
    case "failed":
      return <XCircle className="w-3 h-3 text-red-500" />;
    default:
      return null;
  }
}

function mapTicket(ticket: ApiTicket): TicketView {
  const requesterEmail = normalizeAddress(ticket.requester_email);
  const subject = ticket.subject ?? "(no subject)";
  return {
    id: ticket.id,
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

function normalizeQueuePreviewValue(value: string | null | undefined) {
  return (value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

function mapHistoryStatus(status: string): TicketStatusDisplay {
  if (status === "solved") return "resolved";
  if (status === "closed") return "closed";
  if (status === "pending") return "pending";
  return "open";
}

function inferPrimaryChannel(ticket: TicketView, messages: ConversationMessage[]) {
  const inbound = messages.find((message) => message.direction === "inbound");
  if (inbound) return inbound.channel;
  if (ticket.has_whatsapp && !ticket.has_voice) return "whatsapp";
  if (ticket.has_voice && !ticket.has_whatsapp) return "voice";
  return messages[0]?.channel ?? "email";
}

type ConversationTimelineItem =
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

function buildConversationTimeline(messages: ConversationMessage[]): ConversationTimelineItem[] {
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

async function buildConversationMessages(
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

function mapTicketEvent(event: ApiTicketEvent): HistoryTicketEvent {
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

export function SupportWorkspace() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { demoModeEnabled } = useDemoMode();
  const paramsKey = searchParams.toString();
  const workspaceLayoutRef = useRef<HTMLDivElement | null>(null);
  const [currentUser, setCurrentUser] = useState<CurrentSessionUser | null>(null);
  const [assigneeOptions, setAssigneeOptions] = useState<AdminUserRecord[]>([]);
  const [supportMacros, setSupportMacros] = useState<SupportMacro[]>([]);
  const [whatsAppTemplates, setWhatsAppTemplates] = useState<ActiveWhatsAppTemplate[]>([]);
  const [tickets, setTickets] = useState<TicketView[]>([]);
  const [queueCounts, setQueueCounts] = useState({ all: 0, mine: 0 });
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [selectedTickets, setSelectedTickets] = useState<Set<string>>(new Set());
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [priorityFilter, setPriorityFilter] = useState<"all" | TicketPriorityDisplay>("all");
  const [channelFilter, setChannelFilter] = useState<"all" | "email" | "whatsapp" | "voice">("all");
  const [tagFilter, setTagFilter] = useState("all");
  const [assignedMine, setAssignedMine] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [availableTags, setAvailableTags] = useState<TagRecord[]>([]);
  const [queueLoading, setQueueLoading] = useState(false);
  const [queueError, setQueueError] = useState<string | null>(null);
  const [showMergeModal, setShowMergeModal] = useState(false);
  const [mergeType, setMergeType] = useState<"ticket" | "customer">("ticket");
  const [savedViewsOpen, setSavedViewsOpen] = useState(false);
  const [savedViewsLoading, setSavedViewsLoading] = useState(false);
  const [savedViews, setSavedViews] = useState<SupportSavedView[]>([]);
  const [newSavedViewName, setNewSavedViewName] = useState("");
  const [savedViewSaving, setSavedViewSaving] = useState(false);
  const [savedViewDeletingId, setSavedViewDeletingId] = useState<string | null>(null);
  const [activeSavedViewId, setActiveSavedViewId] = useState<string | null>(null);
  const [bulkActionsOpen, setBulkActionsOpen] = useState(false);
  const [bulkUpdating, setBulkUpdating] = useState(false);
  const [bulkStatusValue, setBulkStatusValue] = useState<"" | TicketStatusDisplay>("");
  const [bulkPriorityValue, setBulkPriorityValue] = useState<"" | TicketPriorityDisplay>("");
  const [bulkAssigneeValue, setBulkAssigneeValue] = useState("__nochange");
  const [bulkAddTagsInput, setBulkAddTagsInput] = useState("");
  const [bulkRemoveTagsInput, setBulkRemoveTagsInput] = useState("");
  const [bulkEmailOpen, setBulkEmailOpen] = useState(false);
  const [bulkEmailSending, setBulkEmailSending] = useState(false);
  const [bulkEmailSubject, setBulkEmailSubject] = useState("");
  const [bulkEmailBody, setBulkEmailBody] = useState("");
  const [bulkEmailAttachments, setBulkEmailAttachments] = useState<ReplyAttachment[]>([]);

  const [conversationMessages, setConversationMessages] = useState<ConversationMessage[]>([]);
  const [selectedTicketMessages, setSelectedTicketMessages] = useState<ConversationMessage[]>([]);
  const [ticketEvents, setTicketEvents] = useState<HistoryTicketEvent[]>([]);
  const [auditEvents, setAuditEvents] = useState<HistoryAuditEvent[]>([]);
  const [customerProfile, setCustomerProfile] = useState<CustomerProfileView | null>(null);
  const [customerTicketHistory, setCustomerTicketHistory] = useState<CustomerTicketHistoryItem[]>([]);
  const [linkedCaseTickets, setLinkedCaseTickets] = useState<LinkedCaseHistoryItem[]>([]);
  const [activeDraft, setActiveDraft] = useState<DraftView | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [replySending, setReplySending] = useState(false);
  const [resendingMessageId, setResendingMessageId] = useState<string | null>(null);
  const [replyError, setReplyError] = useState<string | null>(null);
  const [ticketUpdating, setTicketUpdating] = useState(false);
  const [customerProfileUpdating, setCustomerProfileUpdating] = useState(false);
  const [draftUpdating, setDraftUpdating] = useState(false);
  const [voiceModalOpen, setVoiceModalOpen] = useState(false);
  const [callOptions, setCallOptions] = useState<TicketCallOptions | null>(null);
  const [callOptionsLoading, setCallOptionsLoading] = useState(false);
  const [callQueueing, setCallQueueing] = useState(false);
  const [callError, setCallError] = useState<string | null>(null);
  const [callSuccessMessage, setCallSuccessMessage] = useState<string | null>(null);
  const [selectedCallCandidateId, setSelectedCallCandidateId] = useState("");
  const [manualCallPhone, setManualCallPhone] = useState("");
  const [callReason, setCallReason] = useState("");
  const [queuePaneWidth, setQueuePaneWidth] = usePersistentPaneSize(
    SUPPORT_QUEUE_WIDTH_STORAGE_KEY,
    SUPPORT_QUEUE_WIDTH_DEFAULT
  );
  const [feedback, setFeedback] = useState<FeedbackState>({
    open: false,
    tone: "info",
    title: "",
    message: ""
  });

  const startQueueResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const startWidth = queuePaneWidth;
      const layoutWidth =
        workspaceLayoutRef.current?.getBoundingClientRect().width ?? window.innerWidth;

      startPointerResize(event, {
        cursor: "col-resize",
        onMove: (deltaX) => {
          const maxWidth = Math.min(
            SUPPORT_QUEUE_WIDTH_MAX,
            Math.max(SUPPORT_QUEUE_WIDTH_MIN, layoutWidth - 640)
          );
          setQueuePaneWidth(clampNumber(startWidth + deltaX, SUPPORT_QUEUE_WIDTH_MIN, maxWidth));
        }
      });
    },
    [queuePaneWidth, setQueuePaneWidth]
  );

  useEffect(() => {
    const status = searchParams.get("status") ?? "all";
    const priority = searchParams.get("priority") ?? "all";
    const channel = searchParams.get("channel") ?? "all";
    const assigned = searchParams.get("assigned") ?? "mine";
    const query = searchParams.get("query") ?? "";
    const tag = searchParams.get("tag") ?? "all";

    setStatusFilter(STATUS_FILTER_VALUES.has(status) ? status : "all");
    setPriorityFilter(
      PRIORITY_FILTER_VALUES.has(priority)
        ? (priority as "all" | TicketPriorityDisplay)
        : "all"
    );
    setChannelFilter(
      CHANNEL_FILTER_VALUES.has(channel)
        ? (channel as "all" | "email" | "whatsapp" | "voice")
        : "all"
    );
    setAssignedMine(ASSIGNED_FILTER_VALUES.has(assigned) ? assigned !== "any" : true);
    setSearchQuery(query);
    setTagFilter(tag || "all");
  }, [paramsKey, searchParams]);

  const openFeedback = useCallback(
    (next: Omit<FeedbackState, "open">) => {
      setFeedback({
        open: true,
        ...next
      });
    },
    []
  );

  const currentFilters = useMemo<SavedViewFilters>(
    () => ({
      status: statusFilter as SavedViewFilters["status"],
      priority: priorityFilter,
      channel: channelFilter,
      tag: tagFilter,
      assigned: assignedMine ? "mine" : "any",
      query: searchQuery.trim()
    }),
    [assignedMine, channelFilter, priorityFilter, searchQuery, statusFilter, tagFilter]
  );

  const loadSavedViews = useCallback(async (signal?: AbortSignal) => {
    setSavedViewsLoading(true);
    try {
      const views = await listSupportSavedViews(signal);
      setSavedViews(views);
    } catch (error) {
      if (isAbortError(error)) return;
      setSavedViews([]);
    } finally {
      setSavedViewsLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    void getCurrentSessionUser()
      .then((user) => {
        if (cancelled) return;
        setCurrentUser(user);
        if (user?.role_name === "lead_admin") {
          void listUsers()
            .then((rows) => {
              if (!cancelled) {
                setAssigneeOptions(rows.filter((row) => row.is_active));
              }
            })
            .catch(() => {
              if (!cancelled) {
                setAssigneeOptions([]);
              }
            });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCurrentUser(null);
          setAssigneeOptions([]);
        }
      });

    void listSupportMacros()
      .then((rows) => {
        if (!cancelled) {
          setSupportMacros(rows.filter((macro) => macro.is_active));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSupportMacros([]);
        }
      });

    void listActiveWhatsAppTemplates()
      .then((rows) => {
        if (!cancelled) {
          setWhatsAppTemplates(rows);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setWhatsAppTemplates([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const assigneeNameById = useMemo(
    () =>
      new Map(
        assigneeOptions.map((user) => [user.id, user.display_name || user.email])
      ),
    [assigneeOptions]
  );

  const selectedTicket = useMemo(() => {
    const ticket = tickets.find((entry) => entry.id === selectedTicketId) ?? null;
    if (!ticket) return null;
    const assignedName =
      ticket.assigned_user_name ??
      (ticket.assigned_user_id ? assigneeNameById.get(ticket.assigned_user_id) ?? null : null);
    return {
      ...ticket,
      assigned_user_name: assignedName
    };
  }, [assigneeNameById, selectedTicketId, tickets]);

  const loadTickets = useCallback(
    async (signal?: AbortSignal) => {
      setQueueLoading(true);
      setQueueError(null);

      try {
        const baseFilters = {
          status: statusFilter === "all" ? undefined : (statusFilter as "open" | "pending" | "resolved" | "closed"),
          priority: priorityFilter === "all" ? undefined : priorityFilter,
          tag: tagFilter === "all" ? undefined : tagFilter,
          channel: channelFilter === "all" ? undefined : channelFilter,
          query: searchQuery.trim() || undefined,
          signal
        } as const;

        const [allQueueRows, mineQueueRows] = await Promise.all([
          listTickets(baseFilters),
          listTickets({ ...baseFilters, assigned: "mine" })
        ]);

        setQueueCounts({
          all: allQueueRows.length,
          mine: mineQueueRows.length
        });

        const nextTickets = (assignedMine ? mineQueueRows : allQueueRows).map(mapTicket);
        setTickets(nextTickets);

        setSelectedTickets((previous) => {
          const allowed = new Set(nextTickets.map((ticket) => ticket.id));
          return new Set([...previous].filter((id) => allowed.has(id)));
        });

        setSelectedTicketId((previous) => {
          if (previous && nextTickets.some((ticket) => ticket.id === previous)) {
            return previous;
          }
          return nextTickets[0]?.id ?? null;
        });
      } catch (error) {
        if (isAbortError(error)) return;
        setQueueError(error instanceof Error ? error.message : "Failed to load tickets");
      } finally {
        setQueueLoading(false);
      }
    },
    [assignedMine, channelFilter, priorityFilter, searchQuery, statusFilter, tagFilter]
  );

  useEffect(() => {
    const controller = new AbortController();
    void listTags(controller.signal)
      .then(setAvailableTags)
      .catch(() => setAvailableTags([]));
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadSavedViews(controller.signal);
    return () => controller.abort();
  }, [loadSavedViews]);

  const loadTicketDetails = useCallback(async (ticketId: string, signal?: AbortSignal) => {
    setDetailLoading(true);
    setDetailError(null);
    setReplyError(null);
    try {
      const details = await getTicketDetails(ticketId, signal);
      const mappedSelectedTicketMessages = await buildConversationMessages(details, signal);

      setSelectedTicketMessages(mappedSelectedTicketMessages);
      setTicketEvents(details.events.map(mapTicketEvent));
      setAuditEvents(
        (details.auditLogs ?? []).map((log) => ({
          id: log.id,
          action: toTitleCase(log.action),
          actor: log.actor_name ?? log.actor_email ?? "System",
          entity: `${log.entity_type}${log.entity_id ? ` • ${log.entity_id}` : ""}`,
          timestamp: log.created_at
        }))
      );

      const historyResponse = await getTicketCustomerHistory(ticketId, 30, signal);
      setCustomerProfile(
        historyResponse.customer
          ? {
              id: historyResponse.customer.id,
              kind: historyResponse.customer.kind,
              displayName: historyResponse.customer.display_name,
              primaryEmail: historyResponse.customer.primary_email,
              primaryPhone: historyResponse.customer.primary_phone,
              address: historyResponse.customer.address ?? null,
              identities:
                historyResponse.customer.identities?.map((identity) => ({
                  type: identity.type,
                  value: identity.value,
                  isPrimary: identity.isPrimary
                })) ?? []
            }
          : null
      );
      const mappedHistory = historyResponse.history
        .map((item) => ({
          ticketId: item.ticketId,
          subject: item.subject ?? "(no subject)",
          status: mapHistoryStatus(item.status),
          channel: item.channel,
          lastActivityAt: item.lastCustomerInboundAt ?? item.lastMessageAt ?? details.ticket.updated_at,
          lastCustomerInboundAt: item.lastCustomerInboundAt
        }))
        .sort((left, right) => new Date(right.lastActivityAt).getTime() - new Date(left.lastActivityAt).getTime());
      setCustomerTicketHistory(mappedHistory);
      const mappedLinkedCases = (details.linkedTickets ?? [])
        .map((item) => ({
          linkId: item.linkId,
          ticketId: item.ticketId,
          customerId: item.customerId,
          subject: item.subject ?? "(no subject)",
          status: mapHistoryStatus(item.status),
          priority: DISPLAY_PRIORITY_BY_API[item.priority],
          channel: item.channel,
          requesterEmail: item.requesterEmail,
          linkedAt: item.linkedAt,
          reason: item.reason
        }))
        .sort((left, right) => new Date(right.linkedAt).getTime() - new Date(left.linkedAt).getTime());
      setLinkedCaseTickets(mappedLinkedCases);

      const relatedTicketIds = Array.from(
        new Set(
          [...mappedHistory.map((item) => item.ticketId), ...mappedLinkedCases.map((item) => item.ticketId)]
            .filter((historyTicketId) => historyTicketId && historyTicketId !== ticketId)
        )
      );
      const relatedTicketDetails = await Promise.all(
        relatedTicketIds.map(async (historyTicketId) => {
          try {
            return await getTicketDetails(historyTicketId, signal);
          } catch {
            return null;
          }
        })
      );
      const relatedTimelineGroups = await Promise.all(
        relatedTicketDetails
          .filter((detail): detail is TicketDetailsResponse => Boolean(detail))
          .map(async (detail) => {
            try {
              return await buildConversationMessages(detail, signal);
            } catch {
              return [];
            }
          })
      );
      setConversationMessages(
        [...mappedSelectedTicketMessages, ...relatedTimelineGroups.flat()].sort(
          (left, right) => new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime()
        )
      );

      const pendingDraft = details.drafts
        .filter((draft) => draft.status === "pending")
        .sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime())[0];
      setActiveDraft(
        pendingDraft
          ? {
              id: pendingDraft.id,
              suggested_body:
                pendingDraft.body_text ??
                (pendingDraft.body_html ? stripHtml(pendingDraft.body_html) : "") ??
                "",
              confidence: pendingDraft.confidence
            }
          : null
      );
    } catch (error) {
      if (isAbortError(error)) return;
      setDetailError(error instanceof Error ? error.message : "Failed to load ticket details");
      setConversationMessages([]);
      setSelectedTicketMessages([]);
      setTicketEvents([]);
      setAuditEvents([]);
      setCustomerProfile(null);
      setCustomerTicketHistory([]);
      setLinkedCaseTickets([]);
      setActiveDraft(null);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      void loadTickets(controller.signal);
    }, searchQuery.trim() ? 250 : 0);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [loadTickets, searchQuery]);

  useEffect(() => {
    const matching = savedViews.find((view) => areSavedViewFiltersEqual(view.filters, currentFilters));
    setActiveSavedViewId(matching?.id ?? null);
  }, [currentFilters, savedViews]);

  const activeSavedView = useMemo(
    () => savedViews.find((view) => view.id === activeSavedViewId) ?? null,
    [activeSavedViewId, savedViews]
  );

  const activeQueueFilters = useMemo(
    () =>
      [
        statusFilter !== "all"
          ? { key: "status" as const, label: `Status: ${toTitleCase(statusFilter)}` }
          : null,
        priorityFilter !== "all"
          ? { key: "priority" as const, label: `Priority: ${toTitleCase(priorityFilter)}` }
          : null,
        channelFilter !== "all"
          ? { key: "channel" as const, label: `Channel: ${toTitleCase(channelFilter)}` }
          : null,
        tagFilter !== "all" ? { key: "tag" as const, label: `Tag: ${tagFilter}` } : null
      ].filter((value): value is { key: "status" | "priority" | "channel" | "tag"; label: string } => Boolean(value)),
    [channelFilter, priorityFilter, statusFilter, tagFilter]
  );

  const clearQueueFilter = useCallback((key: "status" | "priority" | "channel" | "tag") => {
    switch (key) {
      case "status":
        setStatusFilter("all");
        return;
      case "priority":
        setPriorityFilter("all");
        return;
      case "channel":
        setChannelFilter("all");
        return;
      case "tag":
        setTagFilter("all");
        return;
    }
  }, []);

  const clearAllQueueFilters = useCallback(() => {
    setStatusFilter("all");
    setPriorityFilter("all");
    setChannelFilter("all");
    setTagFilter("all");
  }, []);

  useEffect(() => {
    if (!selectedTicketId) {
      setConversationMessages([]);
      setSelectedTicketMessages([]);
      setTicketEvents([]);
      setAuditEvents([]);
      setCustomerProfile(null);
      setCustomerTicketHistory([]);
      setActiveDraft(null);
      return;
    }
    const controller = new AbortController();
    void loadTicketDetails(selectedTicketId, controller.signal);
    return () => controller.abort();
  }, [loadTicketDetails, selectedTicketId]);

  useEffect(() => {
    if (selectedTickets.size === 0) {
      setBulkActionsOpen(false);
    }
  }, [selectedTickets.size]);

  useEffect(() => {
    setVoiceModalOpen(false);
    setCallOptions(null);
    setCallOptionsLoading(false);
    setCallQueueing(false);
    setCallError(null);
    setCallSuccessMessage(null);
    setSelectedCallCandidateId("");
    setManualCallPhone("");
    setCallReason(selectedTicket?.subject || "Voice follow-up");
    setCustomerProfileUpdating(false);
  }, [selectedTicket?.id, selectedTicket?.subject]);

  const toggleTicketSelection = (ticketId: string) => {
    setSelectedTickets((previous) => {
      const next = new Set(previous);
      if (next.has(ticketId)) next.delete(ticketId);
      else next.add(ticketId);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedTickets.size === tickets.length) {
      setSelectedTickets(new Set());
    } else {
      setSelectedTickets(new Set(tickets.map((ticket) => ticket.id)));
    }
  };

  const applySavedView = useCallback((view: SupportSavedView) => {
    const normalized = normalizeSavedViewFilters(view.filters);
    setStatusFilter(normalized.status);
    setPriorityFilter(normalized.priority as "all" | TicketPriorityDisplay);
    setChannelFilter(normalized.channel as "all" | "email" | "whatsapp" | "voice");
    setTagFilter(normalized.tag);
    setAssignedMine(normalized.assigned !== "any");
    setSearchQuery(normalized.query);
    setActiveSavedViewId(view.id);
    setSavedViewsOpen(false);
  }, []);

  const saveCurrentView = useCallback(async () => {
    const name = newSavedViewName.trim();
    if (!name) {
      openFeedback({
        tone: "info",
        title: "Name required",
        message: "Enter a name for this saved view."
      });
      return;
    }

    setSavedViewSaving(true);
    try {
      const payload = await createSupportSavedView({
        name,
        filters: currentFilters
      });
      setSavedViews((previous) => [payload.view, ...previous.filter((view) => view.id !== payload.view.id)]);
      setNewSavedViewName("");
      setActiveSavedViewId(payload.view.id);
      openFeedback({
        tone: "success",
        title: "Saved view created",
        message: `Saved "${payload.view.name}".`,
        autoCloseMs: 1500
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to save current view";
      openFeedback({
        tone: "error",
        title: "Save failed",
        message
      });
    } finally {
      setSavedViewSaving(false);
    }
  }, [currentFilters, newSavedViewName, openFeedback]);

  const removeSavedView = useCallback(
    async (viewId: string) => {
      setSavedViewDeletingId(viewId);
      try {
        await deleteSupportSavedView(viewId);
        setSavedViews((previous) => previous.filter((view) => view.id !== viewId));
        setActiveSavedViewId((previous) => (previous === viewId ? null : previous));
        openFeedback({
          tone: "success",
          title: "Saved view deleted",
          message: "The saved view was removed.",
          autoCloseMs: 1500
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to delete saved view";
        openFeedback({
          tone: "error",
          title: "Delete failed",
          message
        });
      } finally {
        setSavedViewDeletingId(null);
      }
    },
    [openFeedback]
  );

  const parseBulkTags = useCallback((value: string) => {
    return Array.from(
      new Set(
        value
          .split(",")
          .map((entry) => entry.trim().toLowerCase())
          .filter(Boolean)
      )
    );
  }, []);

  const applyBulkActions = useCallback(async () => {
    const ticketIds = Array.from(selectedTickets);
    if (ticketIds.length === 0) return;

    const addTags = parseBulkTags(bulkAddTagsInput);
    const removeTags = parseBulkTags(bulkRemoveTagsInput);

    const payload: {
      ticketIds: string[];
      status?: ApiTicket["status"];
      priority?: ApiTicket["priority"];
      assignedUserId?: string | null;
      addTags?: string[];
      removeTags?: string[];
    } = { ticketIds };

    if (bulkStatusValue) {
      payload.status = API_STATUS_BY_DISPLAY[bulkStatusValue];
    }
    if (bulkPriorityValue) {
      payload.priority = API_PRIORITY_BY_DISPLAY[bulkPriorityValue];
    }
    if (currentUser?.role_name === "lead_admin" && bulkAssigneeValue !== "__nochange") {
      payload.assignedUserId = bulkAssigneeValue === "__unassigned" ? null : bulkAssigneeValue;
    }
    if (addTags.length > 0) {
      payload.addTags = addTags;
    }
    if (removeTags.length > 0) {
      payload.removeTags = removeTags;
    }

    const hasUpdates =
      Boolean(payload.status) ||
      Boolean(payload.priority) ||
      Object.prototype.hasOwnProperty.call(payload, "assignedUserId") ||
      addTags.length > 0 ||
      removeTags.length > 0;

    if (!hasUpdates) {
      openFeedback({
        tone: "info",
        title: "No bulk changes selected",
        message: "Pick at least one bulk update before applying."
      });
      return;
    }

    setBulkUpdating(true);
    try {
      const response = await patchTicketsBulk(payload);
      setBulkActionsOpen(false);
      setSelectedTickets(new Set());
      setBulkStatusValue("");
      setBulkPriorityValue("");
      setBulkAssigneeValue("__nochange");
      setBulkAddTagsInput("");
      setBulkRemoveTagsInput("");
      await loadTickets();
      if (selectedTicketId && response.updatedTicketIds.includes(selectedTicketId)) {
        await loadTicketDetails(selectedTicketId);
      }
      openFeedback({
        tone: "success",
        title: "Bulk updates applied",
        message: `Updated ${response.updatedCount} ticket${response.updatedCount === 1 ? "" : "s"}.`,
        autoCloseMs: 1500
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Bulk update failed";
      openFeedback({
        tone: "error",
        title: "Bulk update failed",
        message
      });
    } finally {
      setBulkUpdating(false);
    }
  }, [
    bulkAddTagsInput,
    bulkAssigneeValue,
    bulkPriorityValue,
    bulkRemoveTagsInput,
    bulkStatusValue,
    currentUser?.role_name,
    loadTicketDetails,
    loadTickets,
    openFeedback,
    parseBulkTags,
    selectedTicketId,
    selectedTickets
  ]);

  const resetBulkEmailComposer = useCallback(() => {
    setBulkEmailSubject("");
    setBulkEmailBody("");
    setBulkEmailAttachments([]);
    setBulkEmailSending(false);
  }, []);

  const handleBulkEmailAttachmentChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files ?? []);
      if (files.length === 0) return;

      try {
        const prepared = await encodeAttachments(files);
        setBulkEmailAttachments((previous) => [...previous, ...prepared]);
      } catch {
        openFeedback({
          tone: "error",
          title: "Attachment error",
          message: "Failed to read one or more files for the bulk email."
        });
      } finally {
        event.target.value = "";
      }
    },
    [openFeedback]
  );

  const submitBulkEmail = useCallback(async () => {
    const ticketIds = Array.from(selectedTickets);
    if (ticketIds.length === 0) return;
    if (!bulkEmailSubject.trim() || !bulkEmailBody.trim()) {
      openFeedback({
        tone: "info",
        title: "Subject and message required",
        message: "Add both a subject and an email body before sending."
      });
      return;
    }
    if (demoModeEnabled) {
      openFeedback({
        tone: "info",
        title: "Live data required",
        message: "Switch Sample Data off in Settings to send real bulk email tickets."
      });
      return;
    }

    setBulkEmailSending(true);
    try {
      const response = await createBulkEmailTickets({
        ticketIds,
        subject: bulkEmailSubject.trim(),
        text: bulkEmailBody.trim(),
        attachments: bulkEmailAttachments.map((attachment) => ({
          filename: attachment.filename,
          contentType: attachment.contentType,
          contentBase64: attachment.contentBase64
        }))
      });

      if (response.createdCount > 0) {
        setBulkEmailOpen(false);
        resetBulkEmailComposer();
        setSelectedTickets(new Set());
        await loadTickets();
        if (selectedTicketId && ticketIds.includes(selectedTicketId)) {
          await loadTicketDetails(selectedTicketId);
        }
      }

      const firstIssue = response.results.find((result) => result.status !== "created" && result.detail)?.detail;
      const summary = [
        response.createdCount > 0
          ? `Created ${response.createdCount} outbound email ticket${response.createdCount === 1 ? "" : "s"}.`
          : "No outbound email tickets were created.",
        response.skippedCount > 0
          ? `Skipped ${response.skippedCount} selection${response.skippedCount === 1 ? "" : "s"}.`
          : null,
        response.failedCount > 0
          ? `${response.failedCount} send${response.failedCount === 1 ? "" : "s"} failed.`
          : null,
        firstIssue ? `First issue: ${firstIssue}` : null
      ]
        .filter(Boolean)
        .join(" ");

      openFeedback({
        tone:
          response.createdCount === 0 ? "error" : response.status === "partial" ? "info" : "success",
        title:
          response.createdCount === 0
            ? "Bulk email not sent"
            : response.status === "partial"
              ? "Bulk email partially sent"
              : "Bulk email sent",
        message: summary,
        autoCloseMs: response.createdCount > 0 && response.status === "created" ? 1800 : undefined
      });
    } catch (error) {
      openFeedback({
        tone: "error",
        title: "Bulk email failed",
        message: error instanceof Error ? error.message : "Failed to create bulk email tickets."
      });
    } finally {
      setBulkEmailSending(false);
    }
  }, [
    bulkEmailAttachments,
    bulkEmailBody,
    bulkEmailSubject,
    demoModeEnabled,
    loadTicketDetails,
    loadTickets,
    openFeedback,
    resetBulkEmailComposer,
    selectedTicketId,
    selectedTickets
  ]);

  const updateTicket = useCallback(
    async (
      patch: Partial<{
        status: ApiTicket["status"];
        priority: ApiTicket["priority"];
        assignedUserId: string | null;
        category: string;
        metadata: Record<string, unknown>;
      }>
    ) => {
      if (!selectedTicketId) return false;
      setTicketUpdating(true);
      setReplyError(null);
      try {
        const payload = await patchTicket(selectedTicketId, patch);
        setTickets((previous) =>
          previous.map((ticket) => (ticket.id === selectedTicketId ? mapTicket(payload.ticket) : ticket))
        );
        await loadTicketDetails(selectedTicketId);
        return true;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to update ticket";
        setReplyError(message);
        openFeedback({
          tone: "error",
          title: "Ticket update failed",
          message
        });
        return false;
      } finally {
        setTicketUpdating(false);
      }
    },
    [loadTicketDetails, openFeedback, selectedTicketId]
  );

  const openVoiceCallModal = useCallback(async () => {
    if (!selectedTicketId || !selectedTicket) return;
    setVoiceModalOpen(true);
    setCallOptionsLoading(true);
    setCallError(null);
    setCallSuccessMessage(null);
    try {
      const options = await getTicketCallOptions(selectedTicketId);
      setCallOptions(options);
      setSelectedCallCandidateId(options.defaultCandidateId ?? options.candidates[0]?.candidateId ?? "");
      setManualCallPhone("");
      setCallReason(selectedTicket.subject || "Voice follow-up");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load call options";
      setCallError(message);
    } finally {
      setCallOptionsLoading(false);
    }
  }, [selectedTicket, selectedTicketId]);

  const submitVoiceCall = useCallback(async () => {
    if (!selectedTicketId) return;
    setCallQueueing(true);
    setCallError(null);
    setCallSuccessMessage(null);
    try {
      const response = await queueOutboundCall({
        ticketId: selectedTicketId,
        candidateId: manualCallPhone.trim() ? null : selectedCallCandidateId || null,
        toPhone: manualCallPhone.trim() || null,
        reason: callReason.trim(),
        metadata: { source: "support_workspace" }
      });

      if (response.status === "selection_required") {
        setCallError(response.detail);
        setCallOptions((previous) =>
          previous
            ? {
                ...previous,
                selectionRequired: true,
                defaultCandidateId: response.defaultCandidateId,
                candidates: response.candidates
              }
            : previous
        );
        setSelectedCallCandidateId(response.defaultCandidateId ?? response.candidates[0]?.candidateId ?? "");
        return;
      }

      if (response.status === "blocked" || response.status === "failed") {
        setCallError(response.detail);
        return;
      }

      if (response.status !== "queued") {
        setCallError("Unable to queue call.");
        return;
      }

      setCallSuccessMessage(`Call queued for ${response.toPhone}.`);
      openFeedback({
        tone: "success",
        title: "Call queued",
        message: `Outbound voice follow-up was queued for ${response.toPhone}.`,
        autoCloseMs: 1500
      });
      if (selectedTicketId) {
        await loadTicketDetails(selectedTicketId);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to queue call";
      setCallError(message);
      openFeedback({
        tone: "error",
        title: "Call queue failed",
        message
      });
    } finally {
      setCallQueueing(false);
    }
  }, [
    callReason,
    loadTicketDetails,
    manualCallPhone,
    openFeedback,
    selectedCallCandidateId,
    selectedTicketId
  ]);

  const resendFailedWhatsApp = useCallback(
    async (messageId: string) => {
      setResendingMessageId(messageId);
      setReplyError(null);
      try {
        await resendWhatsAppMessage(messageId);
        if (selectedTicketId) {
          await loadTicketDetails(selectedTicketId);
        }
        openFeedback({
          tone: "success",
          title: "WhatsApp resend queued",
          message: "The failed WhatsApp message has been queued again.",
          autoCloseMs: 1500
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to resend WhatsApp message";
        setReplyError(message);
        openFeedback({
          tone: "error",
          title: "Resend failed",
          message
        });
      } finally {
        setResendingMessageId(null);
      }
    },
    [loadTicketDetails, openFeedback, selectedTicketId]
  );

  const handleHistoryTicketSelect = useCallback(
    async (ticketId: string) => {
      if (!ticketId) return;

      if (tickets.some((entry) => entry.id === ticketId)) {
        setSelectedTicketId(ticketId);
        return;
      }

      try {
        const details = await getTicketDetails(ticketId);
        const mappedTicket = mapTicket(details.ticket);
        setTickets((previous) =>
          previous.some((entry) => entry.id === mappedTicket.id)
            ? previous
            : [mappedTicket, ...previous]
        );
        setSelectedTicketId(mappedTicket.id);
      } catch (error) {
        openFeedback({
          tone: "error",
          title: "Ticket history unavailable",
          message:
            error instanceof Error
              ? error.message
              : "Unable to open this ticket from the customer interaction history."
        });
      }
    },
    [openFeedback, tickets]
  );

  const getPriorityColor = (priority: TicketPriorityDisplay) => {
    switch (priority) {
      case "urgent":
        return "bg-red-100 text-red-700 border-red-200";
      case "high":
        return "bg-orange-100 text-orange-700 border-orange-200";
      case "medium":
        return "bg-blue-100 text-blue-700 border-blue-200";
      case "low":
        return "bg-neutral-100 text-neutral-700 border-neutral-200";
    }
  };

  const getStatusColor = (status: TicketStatusDisplay) => {
    switch (status) {
      case "open":
        return "bg-green-100 text-green-700 border-green-200";
      case "pending":
        return "bg-yellow-100 text-yellow-700 border-yellow-200";
      case "resolved":
        return "bg-blue-100 text-blue-700 border-blue-200";
      case "closed":
        return "bg-neutral-100 text-neutral-700 border-neutral-200";
    }
  };

  return (
    <>
      <div ref={workspaceLayoutRef} className="h-full flex min-w-0">
        {/* Ticket Queue */}
        <div
          className="shrink-0 border-r border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950 flex flex-col"
          style={{ width: queuePaneWidth }}
        >
          {/* Header */}
          <div className="border-b border-neutral-200 bg-white p-4 space-y-3 dark:border-neutral-800 dark:bg-neutral-950">
            <div className="flex items-center justify-between gap-3">
              <h1 className="text-lg font-semibold">Support</h1>
              <div className="flex items-center gap-2">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" className="gap-2">
                      <GitMerge className="w-4 h-4" />
                      Merge
                      <ChevronDown className="w-3 h-3" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      onClick={() => {
                        setMergeType("ticket");
                        setShowMergeModal(true);
                      }}
                    >
                      Merge or Link Tickets
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => {
                        setMergeType("customer");
                        setShowMergeModal(true);
                      }}
                    >
                      Merge Customers
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2"
                  onClick={() => router.push("/tickets/merge-reviews")}
                >
                  <GitMerge className="w-4 h-4" />
                  Reviews
                </Button>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <div className="relative min-w-0 flex-1">
                <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" />
                <Input
                  placeholder="Search tickets..."
                  className="h-8 pr-9"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className={cn(
                      "h-7 rounded-[12px] px-3 text-[12px] font-medium shadow-none",
                      activeQueueFilters.length > 0
                        ? "border-blue-600 bg-blue-600 text-white hover:bg-blue-700 hover:text-white dark:border-blue-500 dark:bg-blue-500 dark:hover:bg-blue-400"
                        : "border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-200 dark:hover:bg-neutral-800/70"
                    )}
                  >
                    <Filter className="h-3.5 w-3.5" />
                    Filter
                    {activeQueueFilters.length > 0 ? (
                      <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-white/18 px-1 text-[10px] font-semibold text-white">
                        {activeQueueFilters.length}
                      </span>
                    ) : null}
                    <ChevronDown className="h-3 w-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-72">
                  <DropdownMenuLabel className="text-[11px] uppercase tracking-[0.18em] text-neutral-500">
                    Queue Filters
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />

                  <DropdownMenuLabel className="pb-1 text-[11px] uppercase tracking-[0.18em] text-neutral-500">
                    Status
                  </DropdownMenuLabel>
                  <DropdownMenuRadioGroup value={statusFilter} onValueChange={setStatusFilter}>
                    <DropdownMenuRadioItem value="all">All statuses</DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="open">Open</DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="pending">Pending</DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="resolved">Resolved</DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="closed">Closed</DropdownMenuRadioItem>
                  </DropdownMenuRadioGroup>

                  <DropdownMenuSeparator />
                  <DropdownMenuLabel className="pb-1 text-[11px] uppercase tracking-[0.18em] text-neutral-500">
                    Priority
                  </DropdownMenuLabel>
                  <DropdownMenuRadioGroup value={priorityFilter} onValueChange={(value) => setPriorityFilter(value as "all" | TicketPriorityDisplay)}>
                    <DropdownMenuRadioItem value="all">All priorities</DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="low">Low</DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="medium">Medium</DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="high">High</DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="urgent">Urgent</DropdownMenuRadioItem>
                  </DropdownMenuRadioGroup>

                  <DropdownMenuSeparator />
                  <DropdownMenuLabel className="pb-1 text-[11px] uppercase tracking-[0.18em] text-neutral-500">
                    Channel
                  </DropdownMenuLabel>
                  <DropdownMenuRadioGroup
                    value={channelFilter}
                    onValueChange={(value) => setChannelFilter(value as "all" | "email" | "whatsapp" | "voice")}
                  >
                    <DropdownMenuRadioItem value="all">All channels</DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="email">Email</DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="whatsapp">WhatsApp</DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="voice">Voice</DropdownMenuRadioItem>
                  </DropdownMenuRadioGroup>

                  <DropdownMenuSeparator />
                  <DropdownMenuLabel className="pb-1 text-[11px] uppercase tracking-[0.18em] text-neutral-500">
                    Tag
                  </DropdownMenuLabel>
                  <DropdownMenuRadioGroup value={tagFilter} onValueChange={setTagFilter}>
                    <DropdownMenuRadioItem value="all">All tags</DropdownMenuRadioItem>
                    {availableTags.map((tag) => (
                      <DropdownMenuRadioItem key={tag.id} value={tag.name}>
                        {tag.name}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>

                  {activeQueueFilters.length > 0 ? (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={clearAllQueueFilters}>Reset filters</DropdownMenuItem>
                    </>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            {activeQueueFilters.length > 0 ? (
              <div className="flex flex-wrap items-center gap-2">
                {activeQueueFilters.map((filter) => (
                  <button
                    key={filter.key}
                    type="button"
                    onClick={() => clearQueueFilter(filter.key)}
                    className="inline-flex h-7 items-center gap-1.5 rounded-[12px] bg-blue-600 px-3 text-[12px] font-medium text-white transition-colors hover:bg-blue-700"
                  >
                    <span>{filter.label}</span>
                    <X className="h-3 w-3" />
                  </button>
                ))}
                <button
                  type="button"
                  onClick={clearAllQueueFilters}
                  className="inline-flex h-7 items-center rounded-[12px] border border-neutral-200 bg-white px-3 text-[12px] font-medium text-neutral-600 transition-colors hover:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-300 dark:hover:bg-neutral-800/70"
                >
                  Clear all
                </button>
              </div>
            ) : null}
          </div>

          <div className="border-b border-neutral-200 bg-neutral-50/80 px-4 py-3 dark:border-neutral-800 dark:bg-neutral-900/70">
            <div className="flex items-center justify-between gap-3">
              <div className="inline-flex items-center gap-1 rounded-[14px] border border-neutral-200 bg-white p-1 dark:border-neutral-800 dark:bg-neutral-950/90">
                <button
                  type="button"
                  onClick={() => setAssignedMine(false)}
                  className={cn(
                    "inline-flex h-7 items-center gap-1.5 rounded-[12px] px-3 text-[12px] font-medium transition-colors",
                    !assignedMine && !activeSavedViewId
                      ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-950"
                      : "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800/70"
                  )}
                >
                  <span
                    className={cn(
                      "inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold",
                      !assignedMine && !activeSavedViewId
                        ? "bg-white/18 text-white dark:bg-neutral-950/10 dark:text-neutral-950"
                        : "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
                    )}
                  >
                    {queueCounts.all}
                  </span>
                  All
                </button>
                <button
                  type="button"
                  onClick={() => setAssignedMine(true)}
                  className={cn(
                    "inline-flex h-7 items-center gap-1.5 rounded-[12px] px-3 text-[12px] font-medium transition-colors",
                    assignedMine && !activeSavedViewId
                      ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-950"
                      : "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800/70"
                  )}
                >
                  <span
                    className={cn(
                      "inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold",
                      assignedMine && !activeSavedViewId
                        ? "bg-white/18 text-white dark:bg-neutral-950/10 dark:text-neutral-950"
                        : "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
                    )}
                  >
                    {queueCounts.mine}
                  </span>
                  Mine
                </button>
                <button
                  type="button"
                  onClick={() => setSavedViewsOpen(true)}
                  className={cn(
                    "inline-flex h-7 items-center gap-1.5 rounded-[12px] px-3 text-[12px] font-medium transition-colors",
                    activeSavedViewId
                      ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-950"
                      : "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800/70"
                  )}
                >
                  Views
                  {activeSavedViewId ? (
                    <span className="inline-flex h-1.5 w-1.5 rounded-full bg-white dark:bg-neutral-950" />
                  ) : null}
                </button>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  className="h-8 rounded-[12px] px-3.5 text-[12px] font-medium bg-neutral-900 text-white hover:bg-neutral-800 dark:bg-white dark:text-neutral-950 dark:hover:bg-neutral-100"
                  onClick={() => router.push("/tickets/new")}
                >
                  <Plus className="h-4 w-4" />
                  Create Ticket
                </Button>
              </div>
            </div>
            {selectedTickets.size > 0 ? (
              <div className="mt-2 flex items-center gap-2">
                <span className="text-[12px] font-medium text-neutral-500 dark:text-neutral-400">
                  {selectedTickets.size} selected
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 rounded-[12px] px-3 text-[12px] font-medium dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-200 dark:hover:bg-neutral-800/70"
                  onClick={() => setBulkActionsOpen(true)}
                >
                  Bulk Actions
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 rounded-[12px] px-3 text-[12px] font-medium dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-200 dark:hover:bg-neutral-800/70"
                  onClick={() => setBulkEmailOpen(true)}
                >
                  <Mail className="h-3.5 w-3.5" />
                  Bulk Email
                </Button>
              </div>
            ) : null}
            {activeSavedView ? (
              <p className="mt-2 text-[12px] text-neutral-500 dark:text-neutral-400">
                View active: <span className="font-medium text-neutral-700 dark:text-neutral-200">{activeSavedView.name}</span>
              </p>
            ) : null}
          </div>

          {/* Ticket List */}
          <div className="flex-1 overflow-y-auto">
            {/* Select All */}
            {tickets.length > 0 && (
              <div className="border-b border-neutral-200 px-4 py-2 flex items-center gap-3 bg-neutral-50">
                <Checkbox
                  checked={
                    selectedTickets.size === tickets.length && tickets.length > 0
                  }
                  onCheckedChange={toggleSelectAll}
                />
                <span className="text-xs text-neutral-600">
                  {tickets.length} {tickets.length === 1 ? 'ticket' : 'tickets'}
                </span>
              </div>
            )}

            {queueLoading ? <div className="p-6 text-sm text-neutral-600">Loading tickets...</div> : null}
            {queueError ? <div className="p-6 text-sm text-red-600">{queueError}</div> : null}

            {/* Tickets */}
            {!queueLoading &&
              !queueError &&
              tickets.map((ticket) => {
                const showPreview =
                  Boolean(ticket.preview) &&
                  normalizeQueuePreviewValue(ticket.preview) !== normalizeQueuePreviewValue(ticket.subject);

                return (
              <div
                key={ticket.id}
                className={cn(
                  'border-b border-neutral-200 p-4 cursor-pointer hover:bg-neutral-50 transition-colors',
                  selectedTicket?.id === ticket.id && 'bg-blue-50 hover:bg-blue-50',
                  ticket.unread && 'bg-blue-50/30'
                )}
                onClick={() => setSelectedTicketId(ticket.id)}
              >
                <div className="flex items-start gap-3">
                  <Checkbox
                    checked={selectedTickets.has(ticket.id)}
                    onCheckedChange={() => toggleTicketSelection(ticket.id)}
                    onClick={(e) => e.stopPropagation()}
                  />

                  <div className="flex-1 min-w-0">
                    {/* Header */}
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs font-medium text-neutral-600">{ticket.id}</span>
                          {ticket.unread && <div className="w-2 h-2 rounded-full bg-blue-500"></div>}
                        </div>
                        <h3 className="font-medium text-sm leading-tight truncate">{ticket.subject}</h3>
                      </div>
                      <span className="text-xs text-neutral-500 whitespace-nowrap">
                        {formatDateRelative(ticket.created_at)}
                      </span>
                    </div>

                    {/* Requester */}
                    <p className="text-xs text-neutral-600 mb-2">{ticket.requester_name}</p>

                    {/* Preview */}
                    {showPreview ? (
                      <p className="text-xs text-neutral-500 line-clamp-2 mb-3">{ticket.preview}</p>
                    ) : null}

                    {/* Meta */}
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge
                        variant="outline"
                        className={cn('text-xs', getPriorityColor(ticket.priority))}
                      >
                        {ticket.priority}
                      </Badge>
                      <Badge variant="outline" className={cn('text-xs', getStatusColor(ticket.status))}>
                        {ticket.status}
                      </Badge>
                      {(ticket.assigned_user_name ||
                        (ticket.assigned_user_id ? assigneeNameById.get(ticket.assigned_user_id) : null)) && (
                        <span className="text-xs text-neutral-600">
                          → {ticket.assigned_user_name ?? assigneeNameById.get(ticket.assigned_user_id ?? "")}
                        </span>
                      )}
                      {ticket.has_whatsapp && (
                        <Badge variant="outline" className="text-xs">
                          WhatsApp
                        </Badge>
                      )}
                      {ticket.has_voice && (
                        <Badge variant="outline" className="text-xs">
                          Voice
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>
              </div>
                );
              })}

            {!queueLoading && !queueError && tickets.length === 0 && (
              <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
                <p className="text-neutral-600 mb-1">No tickets found</p>
                <p className="text-xs text-neutral-500">Try adjusting your filters or create a new ticket.</p>
                <Button size="sm" className="mt-4 gap-2" onClick={() => router.push("/tickets/new")}>
                  <Plus className="h-4 w-4" />
                  New Ticket
                </Button>
              </div>
            )}
          </div>
        </div>

        <ResizeHandle orientation="vertical" onPointerDown={startQueueResize} />

        {/* Ticket Detail */}
        <div className="min-w-0 flex-1 bg-neutral-50 flex items-center justify-center">
          {selectedTicket ? (
            <TicketDetail
              ticket={selectedTicket}
              messages={conversationMessages}
              selectedTicketMessages={selectedTicketMessages}
              events={ticketEvents}
              auditEvents={auditEvents}
              customerProfile={customerProfile}
              customerTicketHistory={customerTicketHistory}
              linkedCaseTickets={linkedCaseTickets}
              draft={activeDraft}
              detailLoading={detailLoading}
              detailError={detailError}
              replySending={replySending}
              resendingMessageId={resendingMessageId}
              replyError={replyError}
              ticketUpdating={ticketUpdating}
              customerProfileUpdating={customerProfileUpdating}
              draftUpdating={draftUpdating}
              availableTags={availableTags}
              macros={supportMacros}
              whatsAppTemplates={whatsAppTemplates}
              assigneeOptions={assigneeOptions}
              currentUser={currentUser}
              onStatusChange={(status) => void updateTicket({ status: API_STATUS_BY_DISPLAY[status] })}
              onPriorityChange={(priority) =>
                void updateTicket({ priority: API_PRIORITY_BY_DISPLAY[priority] })
              }
              onTicketPatch={async (patch) => {
                return updateTicket(patch);
              }}
              onSaveCustomerProfile={async (input) => {
                if (!selectedTicketId || !customerProfile) return false;
                setCustomerProfileUpdating(true);
                try {
                  await patchCustomerProfile(customerProfile.id, {
                    ...input,
                    ticketId: selectedTicketId
                  });
                  await loadTicketDetails(selectedTicketId);
                  openFeedback({
                    tone: "success",
                    title: "Customer profile updated",
                    message: "Customer details were saved to the canonical profile.",
                    autoCloseMs: 1500
                  });
                  return true;
                } catch (error) {
                  const message =
                    error instanceof Error ? error.message : "Failed to update customer profile";
                  openFeedback({
                    tone: "error",
                    title: "Customer update failed",
                    message
                  });
                  return false;
                } finally {
                  setCustomerProfileUpdating(false);
                }
              }}
              onAddTag={async (tag) => {
                if (!selectedTicketId) return;
                setTicketUpdating(true);
                setReplyError(null);
                try {
                  await patchTicketTags(selectedTicketId, { addTags: [tag] });
                  await loadTickets();
                  await loadTicketDetails(selectedTicketId);
                  openFeedback({
                    tone: "success",
                    title: "Tag added",
                    message: `${tag} was added to this ticket.`,
                    autoCloseMs: 1500
                  });
                } catch (error) {
                  const message = error instanceof Error ? error.message : "Failed to add tag";
                  setReplyError(message);
                  openFeedback({
                    tone: "error",
                    title: "Tag update failed",
                    message
                  });
                } finally {
                  setTicketUpdating(false);
                }
              }}
              onRemoveTag={async (tag) => {
                if (!selectedTicketId) return;
                setTicketUpdating(true);
                setReplyError(null);
                try {
                  await patchTicketTags(selectedTicketId, { removeTags: [tag] });
                  await loadTickets();
                  await loadTicketDetails(selectedTicketId);
                  openFeedback({
                    tone: "success",
                    title: "Tag removed",
                    message: `${tag} was removed from this ticket.`,
                    autoCloseMs: 1500
                  });
                } catch (error) {
                  const message = error instanceof Error ? error.message : "Failed to remove tag";
                  setReplyError(message);
                  openFeedback({
                    tone: "error",
                    title: "Tag update failed",
                    message
                  });
                } finally {
                  setTicketUpdating(false);
                }
              }}
              onSendReply={async (input) => {
                if (!selectedTicketId) return false;

                setReplySending(true);
                setReplyError(null);
                try {
                  await sendTicketReply(selectedTicketId, input);
                  await loadTicketDetails(selectedTicketId);
                  await loadTickets();
                  openFeedback({
                    tone: "success",
                    title: "Reply sent",
                    message: "Your response was added to the conversation thread.",
                    autoCloseMs: 1500
                  });
                  return true;
                } catch (error) {
                  const message = error instanceof Error ? error.message : "Failed to send reply";
                  setReplyError(message);
                  openFeedback({
                    tone: "error",
                    title: "Reply failed",
                    message
                  });
                  return false;
                } finally {
                  setReplySending(false);
                }
              }}
              onUseDraft={async (draftId) => {
                if (!selectedTicketId) return;
                setDraftUpdating(true);
                try {
                  await patchTicketDraft(selectedTicketId, draftId, "used");
                  await loadTicketDetails(selectedTicketId);
                  openFeedback({
                    tone: "success",
                    title: "Draft applied",
                    message: "The AI draft has been marked as used.",
                    autoCloseMs: 1500
                  });
                } catch (error) {
                  const message = error instanceof Error ? error.message : "Failed to update draft";
                  setReplyError(message);
                  openFeedback({
                    tone: "error",
                    title: "Draft update failed",
                    message
                  });
                } finally {
                  setDraftUpdating(false);
                }
              }}
              onDismissDraft={async (draftId) => {
                if (!selectedTicketId) return;
                setDraftUpdating(true);
                try {
                  await patchTicketDraft(selectedTicketId, draftId, "dismissed");
                  await loadTicketDetails(selectedTicketId);
                  openFeedback({
                    tone: "success",
                    title: "Draft dismissed",
                    message: "The draft was removed from this ticket workflow.",
                    autoCloseMs: 1500
                  });
                } catch (error) {
                  const message = error instanceof Error ? error.message : "Failed to dismiss draft";
                  setReplyError(message);
                  openFeedback({
                    tone: "error",
                    title: "Dismiss failed",
                    message
                  });
                } finally {
                  setDraftUpdating(false);
                }
              }}
              onOpenVoiceCall={() => {
                void openVoiceCallModal();
              }}
              onResendWhatsApp={async (messageId) => {
                await resendFailedWhatsApp(messageId);
              }}
              onSelectHistoryTicket={(ticketId) => {
                void handleHistoryTicketSelect(ticketId);
              }}
            />
          ) : (
            <div className="text-center">
              <p className="text-neutral-600 mb-1">Select a ticket to view details</p>
              <p className="text-xs text-neutral-500">Choose from the list on the left</p>
            </div>
          )}
        </div>
      </div>

      <Dialog open={savedViewsOpen} onOpenChange={setSavedViewsOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Saved Views</DialogTitle>
            <DialogDescription>
              Save queue filter presets and re-apply them quickly.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-2">
            <div className="rounded-lg border border-neutral-200 p-3">
              <p className="mb-2 text-xs font-medium text-neutral-600">Save current filters</p>
              <div className="flex items-center gap-2">
                <Input
                  value={newSavedViewName}
                  onChange={(event) => setNewSavedViewName(event.target.value)}
                  placeholder="My high-priority queue"
                  disabled={savedViewSaving}
                />
                <Button
                  size="sm"
                  onClick={() => {
                    void saveCurrentView();
                  }}
                  disabled={savedViewSaving}
                >
                  {savedViewSaving ? "Saving..." : "Save"}
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              {savedViewsLoading ? (
                <p className="text-sm text-neutral-600">Loading saved views...</p>
              ) : savedViews.length === 0 ? (
                <p className="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-500">
                  No saved views yet.
                </p>
              ) : (
                savedViews.map((view) => (
                  <div
                    key={view.id}
                    className={cn(
                      "flex items-center justify-between gap-2 rounded-lg border px-3 py-2",
                      activeSavedViewId === view.id ? "border-blue-300 bg-blue-50" : "border-neutral-200 bg-white"
                    )}
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-neutral-900">{view.name}</p>
                      <p className="text-xs text-neutral-500">
                        Updated {formatDateRelative(view.updatedAt)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => applySavedView(view)}
                      >
                        Apply
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={savedViewDeletingId === view.id}
                        onClick={() => {
                          void removeSavedView(view.id);
                        }}
                      >
                        {savedViewDeletingId === view.id ? "Deleting..." : "Delete"}
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setSavedViewsOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={bulkActionsOpen} onOpenChange={setBulkActionsOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Bulk Actions</DialogTitle>
            <DialogDescription>
              Apply updates to {selectedTickets.size} selected ticket{selectedTickets.size === 1 ? "" : "s"}.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-2">
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="grid gap-1.5 text-xs font-medium text-neutral-600">
                Status
                <select
                  className="h-9 rounded-md border border-neutral-200 bg-white px-3 text-sm"
                  value={bulkStatusValue}
                  onChange={(event) =>
                    setBulkStatusValue((event.target.value as TicketStatusDisplay) || "")
                  }
                  disabled={bulkUpdating}
                >
                  <option value="">No change</option>
                  <option value="open">Open</option>
                  <option value="pending">Pending</option>
                  <option value="resolved">Resolved</option>
                  <option value="closed">Closed</option>
                </select>
              </label>

              <label className="grid gap-1.5 text-xs font-medium text-neutral-600">
                Priority
                <select
                  className="h-9 rounded-md border border-neutral-200 bg-white px-3 text-sm"
                  value={bulkPriorityValue}
                  onChange={(event) =>
                    setBulkPriorityValue((event.target.value as TicketPriorityDisplay) || "")
                  }
                  disabled={bulkUpdating}
                >
                  <option value="">No change</option>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
              </label>
            </div>

            {currentUser?.role_name === "lead_admin" ? (
              <label className="grid gap-1.5 text-xs font-medium text-neutral-600">
                Assignee
                <select
                  className="h-9 rounded-md border border-neutral-200 bg-white px-3 text-sm"
                  value={bulkAssigneeValue}
                  onChange={(event) => setBulkAssigneeValue(event.target.value)}
                  disabled={bulkUpdating}
                >
                  <option value="__nochange">No change</option>
                  <option value="__unassigned">Unassigned</option>
                  {assigneeOptions.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.display_name} ({user.email})
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            <label className="grid gap-1.5 text-xs font-medium text-neutral-600">
              Add tags (comma separated)
              <Input
                value={bulkAddTagsInput}
                onChange={(event) => setBulkAddTagsInput(event.target.value)}
                placeholder="urgent, vip"
                disabled={bulkUpdating}
              />
            </label>

            <label className="grid gap-1.5 text-xs font-medium text-neutral-600">
              Remove tags (comma separated)
              <Input
                value={bulkRemoveTagsInput}
                onChange={(event) => setBulkRemoveTagsInput(event.target.value)}
                placeholder="general, low-priority"
                disabled={bulkUpdating}
              />
            </label>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setBulkActionsOpen(false)}
              disabled={bulkUpdating}
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                void applyBulkActions();
              }}
              disabled={bulkUpdating || selectedTickets.size === 0}
            >
              {bulkUpdating ? "Applying..." : "Apply Updates"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={bulkEmailOpen}
        onOpenChange={(open) => {
          setBulkEmailOpen(open);
          if (!open && !bulkEmailSending) {
            resetBulkEmailComposer();
          }
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Create Bulk Email Tickets</DialogTitle>
            <DialogDescription>
              Send one email to each selected customer and create a new outbound email ticket per resolved recipient.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-2">
            <div className="flex flex-wrap items-center gap-2 text-[12px] text-neutral-500 dark:text-neutral-400">
              <span>{selectedTickets.size} selected ticket{selectedTickets.size === 1 ? "" : "s"}</span>
              <span className="inline-flex h-1 w-1 rounded-full bg-neutral-300 dark:bg-neutral-700" />
              <span>{bulkEmailAttachments.length} attachment{bulkEmailAttachments.length === 1 ? "" : "s"}</span>
            </div>

            {demoModeEnabled ? (
              <div className="rounded-[14px] border border-blue-200 bg-blue-50 px-4 py-3 text-[12px] text-blue-900 dark:border-blue-900/50 dark:bg-blue-950/40 dark:text-blue-100">
                Bulk email is wired for live mode only. Switch Sample Data off in Settings to send real customer emails.
              </div>
            ) : null}

            <label className="grid gap-1.5 text-xs font-medium text-neutral-600 dark:text-neutral-300">
              Subject
              <Input
                value={bulkEmailSubject}
                onChange={(event) => setBulkEmailSubject(event.target.value)}
                placeholder="Quarterly product update"
                disabled={bulkEmailSending}
              />
            </label>

            <label className="grid gap-1.5 text-xs font-medium text-neutral-600 dark:text-neutral-300">
              Email body
              <Textarea
                rows={8}
                value={bulkEmailBody}
                onChange={(event) => setBulkEmailBody(event.target.value)}
                placeholder="Write the email that should be sent to every resolved customer address."
                disabled={bulkEmailSending}
              />
            </label>

            {bulkEmailAttachments.length > 0 ? (
              <div className="space-y-2">
                {bulkEmailAttachments.map((attachment) => (
                  <div
                    key={attachment.id}
                    className="flex items-center justify-between rounded-lg border border-neutral-200 bg-white px-3 py-2 dark:border-neutral-800 dark:bg-neutral-950"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-xs font-medium text-neutral-900 dark:text-neutral-100">
                        {attachment.filename}
                      </p>
                      <p className="text-xs text-neutral-500 dark:text-neutral-400">
                        {formatFileSize(attachment.size)}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={bulkEmailSending}
                      onClick={() =>
                        setBulkEmailAttachments((previous) =>
                          previous.filter((entry) => entry.id !== attachment.id)
                        )
                      }
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            ) : null}

            <div className="flex items-center justify-between gap-3 rounded-[14px] border border-neutral-200 bg-neutral-50 px-3 py-2 dark:border-neutral-800 dark:bg-neutral-900/70">
              <div className="text-[12px] text-neutral-500 dark:text-neutral-400">
                Attachments are copied onto each new outbound email ticket.
              </div>
              <label className="inline-flex">
                <input
                  type="file"
                  className="hidden"
                  multiple
                  onChange={(event) => {
                    void handleBulkEmailAttachmentChange(event);
                  }}
                  disabled={bulkEmailSending}
                />
                <span className="inline-flex items-center gap-2 rounded-[12px] border border-neutral-200 bg-white px-3 py-1.5 text-[12px] font-medium text-neutral-700 transition-colors hover:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-200 dark:hover:bg-neutral-800/70">
                  <Upload className="h-3.5 w-3.5" />
                  Attach files
                </span>
              </label>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setBulkEmailOpen(false);
                if (!bulkEmailSending) {
                  resetBulkEmailComposer();
                }
              }}
              disabled={bulkEmailSending}
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                void submitBulkEmail();
              }}
              disabled={
                bulkEmailSending ||
                demoModeEnabled ||
                selectedTickets.size === 0 ||
                !bulkEmailSubject.trim() ||
                !bulkEmailBody.trim()
              }
            >
              {bulkEmailSending ? "Creating..." : "Create & Send"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Merge Modal */}
      <MergeModal
        open={showMergeModal}
        onClose={() => setShowMergeModal(false)}
        type={mergeType}
        onMerged={() => {
          void loadTickets();
          if (selectedTicketId) {
            void loadTicketDetails(selectedTicketId);
          }
        }}
      />

      <VoiceCallModal
        open={voiceModalOpen}
        onClose={() => setVoiceModalOpen(false)}
        ticketLabel={selectedTicket ? `${selectedTicket.id} • ${selectedTicket.subject}` : "Voice call"}
        options={callOptions}
        loading={callOptionsLoading}
        queueing={callQueueing}
        error={callError}
        successMessage={callSuccessMessage}
        selectedCandidateId={selectedCallCandidateId}
        manualPhone={manualCallPhone}
        reason={callReason}
        onSelectedCandidateIdChange={setSelectedCallCandidateId}
        onManualPhoneChange={setManualCallPhone}
        onReasonChange={setCallReason}
        onQueue={() => {
          void submitVoiceCall();
        }}
      />

      <ActionFeedbackModal
        open={feedback.open}
        onClose={() =>
          setFeedback((previous) => ({
            ...previous,
            open: false
          }))
        }
        tone={feedback.tone}
        title={feedback.title}
        message={feedback.message}
        autoCloseMs={feedback.autoCloseMs}
      />
    </>
  );
}

function TicketDetail({
  ticket,
  messages,
  selectedTicketMessages,
  events,
  auditEvents,
  customerProfile,
  customerTicketHistory,
  linkedCaseTickets,
  draft,
  detailLoading,
  detailError,
  replySending,
  resendingMessageId,
  replyError,
  ticketUpdating,
  customerProfileUpdating,
  draftUpdating,
  availableTags,
  macros,
  whatsAppTemplates,
  assigneeOptions,
  currentUser,
  onStatusChange,
  onPriorityChange,
  onTicketPatch,
  onSaveCustomerProfile,
  onAddTag,
  onRemoveTag,
  onSendReply,
  onUseDraft,
  onDismissDraft,
  onOpenVoiceCall,
  onResendWhatsApp,
  onSelectHistoryTicket
}: {
  ticket: TicketView;
  messages: ConversationMessage[];
  selectedTicketMessages: ConversationMessage[];
  events: HistoryTicketEvent[];
  auditEvents: HistoryAuditEvent[];
  customerProfile: CustomerProfileView | null;
  customerTicketHistory: CustomerTicketHistoryItem[];
  linkedCaseTickets: LinkedCaseHistoryItem[];
  draft: DraftView | null;
  detailLoading: boolean;
  detailError: string | null;
  replySending: boolean;
  resendingMessageId: string | null;
  replyError: string | null;
  ticketUpdating: boolean;
  customerProfileUpdating: boolean;
  draftUpdating: boolean;
  availableTags: TagRecord[];
  macros: SupportMacro[];
  whatsAppTemplates: ActiveWhatsAppTemplate[];
  assigneeOptions: AdminUserRecord[];
  currentUser: CurrentSessionUser | null;
  onStatusChange: (status: TicketStatusDisplay) => void;
  onPriorityChange: (priority: TicketPriorityDisplay) => void;
  onTicketPatch: (patch: {
    assignedUserId?: string | null;
    category?: string;
    metadata?: Record<string, unknown>;
  }) => Promise<boolean>;
  onSaveCustomerProfile: (input: {
    displayName?: string | null;
    primaryEmail?: string | null;
    primaryPhone?: string | null;
    address?: string | null;
  }) => Promise<boolean>;
  onAddTag: (tag: string) => Promise<void>;
  onRemoveTag: (tag: string) => Promise<void>;
  onSendReply: (input: {
    text?: string | null;
    recipient?: string | null;
    template?: {
      name: string;
      language: string;
      components?: Array<Record<string, unknown>>;
    } | null;
    attachments?: Array<{
      filename: string;
      contentType?: string | null;
      size?: number | null;
      contentBase64: string;
    }> | null;
  }) => Promise<boolean>;
  onUseDraft: (draftId: string) => Promise<void>;
  onDismissDraft: (draftId: string) => Promise<void>;
  onOpenVoiceCall: () => void;
  onResendWhatsApp: (messageId: string) => Promise<void>;
  onSelectHistoryTicket: (ticketId: string) => void;
}) {
  const detailLayoutRef = useRef<HTMLDivElement | null>(null);
  const mainColumnRef = useRef<HTMLDivElement | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [showAIDraft, setShowAIDraft] = useState(true);
  const [customerEditorOpen, setCustomerEditorOpen] = useState(false);
  const [metadataEditorOpen, setMetadataEditorOpen] = useState(false);
  const [metadataInput, setMetadataInput] = useState(
    JSON.stringify(ticket.metadata ?? {}, null, 2)
  );
  const [metadataError, setMetadataError] = useState<string | null>(null);
  const [newTag, setNewTag] = useState("");
  const [composerError, setComposerError] = useState<string | null>(null);
  const [showMacroPicker, setShowMacroPicker] = useState(false);
  const [macroQuery, setMacroQuery] = useState("");
  const [replyAttachments, setReplyAttachments] = useState<ReplyAttachment[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [waTemplateParams, setWaTemplateParams] = useState("");
  const [selectedRecipient, setSelectedRecipient] = useState("");
  const [recipientOverrideOpen, setRecipientOverrideOpen] = useState(false);
  const [recipientOverrideInput, setRecipientOverrideInput] = useState("");
  const [selectedAssigneeId, setSelectedAssigneeId] = useState(ticket.assigned_user_id ?? "");
  const [customerDisplayNameInput, setCustomerDisplayNameInput] = useState("");
  const [customerPrimaryEmailInput, setCustomerPrimaryEmailInput] = useState("");
  const [customerPrimaryPhoneInput, setCustomerPrimaryPhoneInput] = useState("");
  const [customerAddressInput, setCustomerAddressInput] = useState("");
  const [customerProfileError, setCustomerProfileError] = useState<string | null>(null);
  const [detailSidebarWidth, setDetailSidebarWidth] = usePersistentPaneSize(
    SUPPORT_DETAIL_SIDEBAR_WIDTH_STORAGE_KEY,
    SUPPORT_DETAIL_SIDEBAR_WIDTH_DEFAULT
  );
  const [composerHeight, setComposerHeight] = usePersistentPaneSize(
    SUPPORT_COMPOSER_HEIGHT_STORAGE_KEY,
    SUPPORT_COMPOSER_HEIGHT_DEFAULT
  );
  const conversationScrollRef = useRef<HTMLDivElement | null>(null);
  const timelineItemRefs = useRef(new Map<string, HTMLDivElement>());
  const pendingTimelineFocusTicketIdRef = useRef<string | null>(ticket.id);
  const pendingTimelineFocusBehaviorRef = useRef<ScrollBehavior>("auto");
  const [activeTimelineTicketId, setActiveTimelineTicketId] = useState<string>(ticket.id);
  const [activeTimelineChannel, setActiveTimelineChannel] = useState<ConversationMessage["channel"] | null>(null);

  const startDetailSidebarResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const startWidth = detailSidebarWidth;
      const layoutWidth = detailLayoutRef.current?.getBoundingClientRect().width ?? window.innerWidth;

      startPointerResize(event, {
        cursor: "col-resize",
        onMove: (deltaX) => {
          const maxWidth = Math.min(
            SUPPORT_DETAIL_SIDEBAR_WIDTH_MAX,
            Math.max(SUPPORT_DETAIL_SIDEBAR_WIDTH_MIN, layoutWidth - 520)
          );
          setDetailSidebarWidth(
            clampNumber(startWidth - deltaX, SUPPORT_DETAIL_SIDEBAR_WIDTH_MIN, maxWidth)
          );
        }
      });
    },
    [detailSidebarWidth, setDetailSidebarWidth]
  );

  const startComposerResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const startHeight = composerHeight;
      const columnHeight = mainColumnRef.current?.getBoundingClientRect().height ?? window.innerHeight;

      startPointerResize(event, {
        cursor: "row-resize",
        onMove: (_deltaX, deltaY) => {
          const maxHeight = Math.min(
            SUPPORT_COMPOSER_HEIGHT_MAX,
            Math.max(SUPPORT_COMPOSER_HEIGHT_MIN, columnHeight - 260)
          );
          setComposerHeight(
            clampNumber(startHeight - deltaY, SUPPORT_COMPOSER_HEIGHT_MIN, maxHeight)
          );
        }
      });
    },
    [composerHeight, setComposerHeight]
  );

  useEffect(() => {
    setReplyText("");
    setShowAIDraft(true);
    setMetadataInput(JSON.stringify(ticket.metadata ?? {}, null, 2));
    setMetadataError(null);
    setCustomerEditorOpen(false);
    setMetadataEditorOpen(false);
    setNewTag("");
    setComposerError(null);
    setShowMacroPicker(false);
    setMacroQuery("");
    setReplyAttachments([]);
    setSelectedTemplateId("");
    setWaTemplateParams("");
    setRecipientOverrideOpen(false);
    setRecipientOverrideInput("");
    setSelectedAssigneeId(ticket.assigned_user_id ?? "");
    setCustomerDisplayNameInput(customerProfile?.displayName?.trim() ?? ticket.requester_name);
    setCustomerPrimaryEmailInput(
      customerProfile?.primaryEmail ?? (ticket.requester_email.includes("@") ? ticket.requester_email : "")
    );
    setCustomerPrimaryPhoneInput(
      customerProfile?.primaryPhone ??
        (ticket.requester_email.startsWith("whatsapp:") || ticket.requester_email.startsWith("voice:")
          ? normalizeAddress(ticket.requester_email)
          : "")
    );
    setCustomerAddressInput((customerProfile?.address ?? deriveCustomerAddress(customerProfile?.address, ticket.metadata) ?? "").trim());
    setCustomerProfileError(null);
  }, [
    customerProfile?.id,
    customerProfile?.address,
    customerProfile?.displayName,
    customerProfile?.primaryEmail,
    customerProfile?.primaryPhone,
    ticket.assigned_user_id,
    ticket.category,
    ticket.id,
    ticket.metadata,
    ticket.requester_email,
    ticket.requester_name
  ]);

  const metadataEntries = useMemo(() => {
    if (!ticket.metadata || typeof ticket.metadata !== "object") return [];
    return Object.entries(ticket.metadata).slice(0, 8);
  }, [ticket.metadata]);

  const customerDisplayName = useMemo(() => {
    return customerProfile?.displayName?.trim() || ticket.requester_name;
  }, [customerProfile?.displayName, ticket.requester_name]);

  const customerDisplayEmail = useMemo(() => {
    if (customerProfile?.primaryEmail) {
      return customerProfile.primaryEmail;
    }
    if (ticket.requester_email.includes("@")) {
      return ticket.requester_email;
    }
    return null;
  }, [customerProfile?.primaryEmail, ticket.requester_email]);

  const customerDisplayPhone = useMemo(() => {
    if (customerProfile?.primaryPhone) {
      return customerProfile.primaryPhone;
    }
    if (ticket.requester_email.startsWith("whatsapp:") || ticket.requester_email.startsWith("voice:")) {
      return normalizeAddress(ticket.requester_email);
    }
    return null;
  }, [customerProfile?.primaryPhone, ticket.requester_email]);

  const customerDisplayAddress = useMemo(() => {
    return deriveCustomerAddress(customerProfile?.address, ticket.metadata);
  }, [customerProfile?.address, ticket.metadata]);

  const primaryChannel = useMemo(
    () => inferPrimaryChannel(ticket, selectedTicketMessages),
    [selectedTicketMessages, ticket]
  );

  const conversationTimeline = useMemo(
    () => buildConversationTimeline(messages),
    [messages]
  );

  const registerTimelineItem = useCallback((itemId: string, node: HTMLDivElement | null) => {
    if (node) {
      timelineItemRefs.current.set(itemId, node);
      return;
    }
    timelineItemRefs.current.delete(itemId);
  }, []);

  const scrollTimelineToTicketId = useCallback(
    (ticketId: string, behavior: ScrollBehavior = "smooth") => {
      const targetItem = conversationTimeline.find((item) => item.ticketId === ticketId);
      const container = conversationScrollRef.current;
      if (!targetItem || !container) return false;
      const node = timelineItemRefs.current.get(targetItem.id);
      if (!node) return false;
      container.scrollTo({
        top: Math.max(0, node.offsetTop - 12),
        behavior
      });
      setActiveTimelineTicketId(targetItem.ticketId);
      setActiveTimelineChannel(targetItem.channel);
      return true;
    },
    [conversationTimeline]
  );

  const syncActiveTimelineFromScroll = useCallback(() => {
    if (conversationTimeline.length === 0) {
      setActiveTimelineTicketId(ticket.id);
      setActiveTimelineChannel(primaryChannel);
      return;
    }

    const container = conversationScrollRef.current;
    if (!container) return;
    const containerTop = container.getBoundingClientRect().top;
    const anchorOffset = 96;
    let activeItem = conversationTimeline[0];

    for (const item of conversationTimeline) {
      const node = timelineItemRefs.current.get(item.id);
      if (!node) continue;
      const topOffset = node.getBoundingClientRect().top - containerTop;
      if (topOffset <= anchorOffset) {
        activeItem = item;
        continue;
      }
      break;
    }

    setActiveTimelineTicketId(activeItem.ticketId);
    setActiveTimelineChannel(activeItem.channel);
  }, [conversationTimeline, primaryChannel, ticket.id]);

  const activeTimelineTicketIdValue = activeTimelineTicketId || ticket.id;
  const activeTimelineChannelValue = activeTimelineChannel ?? primaryChannel;

  const interactionHistoryRows = useMemo(() => {
    const byTicketId = new Map<string, CustomerTicketHistoryItem>();
    for (const item of customerTicketHistory) {
      if (!byTicketId.has(item.ticketId)) {
        byTicketId.set(item.ticketId, item);
      }
    }

    if (!byTicketId.has(ticket.id)) {
      byTicketId.set(ticket.id, {
        ticketId: ticket.id,
        subject: ticket.subject,
        status: ticket.status,
        channel: primaryChannel,
        lastActivityAt: ticket.updated_at,
        lastCustomerInboundAt: null
      });
    }

    return Array.from(byTicketId.values()).sort(
      (left, right) => new Date(right.lastActivityAt).getTime() - new Date(left.lastActivityAt).getTime()
    );
  }, [customerTicketHistory, primaryChannel, ticket.id, ticket.status, ticket.subject, ticket.updated_at]);

  const linkedCaseRows = useMemo(() => {
    const deduped = new Map<string, LinkedCaseHistoryItem>();
    for (const item of linkedCaseTickets) {
      if (!deduped.has(item.ticketId)) {
        deduped.set(item.ticketId, item);
      }
    }
    return Array.from(deduped.values()).sort(
      (left, right) => new Date(right.linkedAt).getTime() - new Date(left.linkedAt).getTime()
    );
  }, [linkedCaseTickets]);

  const getHistoryStatusColor = useCallback((status: TicketStatusDisplay) => {
    if (status === "open") return "border-green-200 bg-green-50 text-green-700";
    if (status === "pending") return "border-yellow-200 bg-yellow-50 text-yellow-700";
    if (status === "resolved") return "border-blue-200 bg-blue-50 text-blue-700";
    return "border-neutral-200 bg-neutral-50 text-neutral-700";
  }, []);

  const replyRecipientOptions = useMemo(() => {
    const options = new Map<string, ReplyRecipientOption>();

    const addOption = (rawValue: string | null | undefined, label: string, isPrimary = false) => {
      const normalized =
        primaryChannel === "whatsapp"
          ? normalizeRecipientPhone(rawValue)
          : normalizeRecipientEmail(rawValue);
      if (!normalized) return;

      const existing = options.get(normalized);
      if (!existing) {
        options.set(normalized, { value: normalized, label, isPrimary });
        return;
      }
      if (isPrimary && !existing.isPrimary) {
        options.set(normalized, {
          ...existing,
          label: `${existing.label} (Primary)`,
          isPrimary: true
        });
      }
    };

    if (primaryChannel === "whatsapp") {
      const requesterPhone = ticket.requester_email.startsWith("whatsapp:")
        ? ticket.requester_email.replace(/^whatsapp:/, "")
        : null;
      addOption(requesterPhone, "Current ticket requester", true);
      addOption(customerProfile?.primaryPhone, "Customer primary", true);
      for (const identity of customerProfile?.identities ?? []) {
        if (identity.type === "phone") {
          addOption(identity.value, "Customer identity", identity.isPrimary);
        }
      }
      for (const message of selectedTicketMessages) {
        addOption(message.from.phone, message.direction === "inbound" ? "Inbound contact" : "Known contact");
        addOption(message.to.phone, "Known contact");
      }
    } else if (primaryChannel === "email") {
      addOption(
        ticket.requester_email.startsWith("whatsapp:") || ticket.requester_email.startsWith("voice:")
          ? null
          : ticket.requester_email,
        "Current ticket requester",
        true
      );
      addOption(customerProfile?.primaryEmail, "Customer primary", true);
      for (const identity of customerProfile?.identities ?? []) {
        if (identity.type === "email") {
          addOption(identity.value, "Customer identity", identity.isPrimary);
        }
      }
      for (const message of selectedTicketMessages) {
        addOption(message.from.email, message.direction === "inbound" ? "Inbound contact" : "Known contact");
        addOption(message.to.email, "Known contact");
      }
    }

    return Array.from(options.values());
  }, [
    customerProfile?.identities,
    customerProfile?.primaryEmail,
    customerProfile?.primaryPhone,
    primaryChannel,
    selectedTicketMessages,
    ticket.requester_email
  ]);

  useEffect(() => {
    if (primaryChannel === "voice") {
      setSelectedRecipient("");
      return;
    }
    setSelectedRecipient((current) => {
      if (current && replyRecipientOptions.some((option) => option.value === current)) {
        return current;
      }
      const preferred = replyRecipientOptions.find((option) => option.isPrimary);
      return preferred?.value ?? replyRecipientOptions[0]?.value ?? "";
    });
  }, [primaryChannel, replyRecipientOptions, ticket.id]);

  useEffect(() => {
    pendingTimelineFocusTicketIdRef.current = ticket.id;
    pendingTimelineFocusBehaviorRef.current = "auto";
    setActiveTimelineTicketId(ticket.id);
    setActiveTimelineChannel(primaryChannel);
  }, [primaryChannel, ticket.id]);

  useEffect(() => {
    if (conversationTimeline.length === 0) {
      setActiveTimelineTicketId(ticket.id);
      setActiveTimelineChannel(primaryChannel);
      return;
    }

    const focusTicketId = pendingTimelineFocusTicketIdRef.current ?? ticket.id;
    const focusBehavior = pendingTimelineFocusBehaviorRef.current;
    const frame = window.requestAnimationFrame(() => {
      if (!scrollTimelineToTicketId(focusTicketId, focusBehavior)) {
        conversationScrollRef.current?.scrollTo({ top: 0, behavior: focusBehavior });
        syncActiveTimelineFromScroll();
      }
      pendingTimelineFocusTicketIdRef.current = null;
      pendingTimelineFocusBehaviorRef.current = "auto";
    });

    return () => window.cancelAnimationFrame(frame);
  }, [conversationTimeline, primaryChannel, scrollTimelineToTicketId, syncActiveTimelineFromScroll, ticket.id]);

  const selectedTemplate = useMemo(
    () => whatsAppTemplates.find((template) => template.id === selectedTemplateId) ?? null,
    [selectedTemplateId, whatsAppTemplates]
  );

  const selectedTemplateParamCount = useMemo(
    () => getTemplateParamCount(selectedTemplate),
    [selectedTemplate]
  );

  const templateParamList = useMemo(
    () =>
      waTemplateParams
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    [waTemplateParams]
  );

  const missingTemplateParams = selectedTemplateParamCount
    ? Math.max(0, selectedTemplateParamCount - templateParamList.length)
    : 0;

  const whatsappWindow = useMemo(() => {
    if (primaryChannel !== "whatsapp") return null;
    const inboundTimes = selectedTicketMessages
      .filter((message) => message.channel === "whatsapp" && message.direction === "inbound")
      .map((message) => Date.parse(message.timestamp))
      .filter((value) => !Number.isNaN(value));
    if (inboundTimes.length === 0) {
      return { isOpen: false, minutesRemaining: 0 } satisfies WhatsAppWindowState;
    }
    const lastInbound = Math.max(...inboundTimes);
    const expiresAt = lastInbound + 24 * 60 * 60 * 1000;
    const now = Date.now();
    const isOpen = now <= expiresAt;
    return {
      isOpen,
      minutesRemaining: isOpen ? Math.max(0, Math.ceil((expiresAt - now) / 60000)) : 0
    } satisfies WhatsAppWindowState;
  }, [primaryChannel, selectedTicketMessages]);

  const tagSuggestions = useMemo(() => {
    const normalized = newTag.trim().toLowerCase();
    return availableTags
      .filter((candidate) => !ticket.tags.includes(candidate.name))
      .filter((candidate) => !normalized || candidate.name.includes(normalized))
      .slice(0, 5);
  }, [availableTags, newTag, ticket.tags]);

  const displayReplyError = composerError ?? replyError;

  const recipientSuggestions = useMemo(() => {
    const query = recipientOverrideInput.trim().toLowerCase();
    const candidates = query
      ? replyRecipientOptions.filter(
          (option) =>
            option.value.toLowerCase().includes(query) || option.label.toLowerCase().includes(query)
        )
      : replyRecipientOptions;
    return candidates.slice(0, 5);
  }, [recipientOverrideInput, replyRecipientOptions]);

  const defaultRecipientOption = useMemo(
    () => replyRecipientOptions.find((option) => option.value === selectedRecipient) ?? null,
    [replyRecipientOptions, selectedRecipient]
  );

  const customerProfileDirty = useMemo(() => {
    if (!customerProfile) return false;
    const nextDisplayName = customerDisplayNameInput.trim();
    const nextPrimaryEmail = customerPrimaryEmailInput.trim().toLowerCase();
    const nextPrimaryPhone = customerPrimaryPhoneInput.trim();
    const nextAddress = customerAddressInput.trim();
    const currentDisplayName = customerProfile.displayName?.trim() ?? "";
    const currentPrimaryEmail = customerProfile.primaryEmail?.trim().toLowerCase() ?? "";
    const currentPrimaryPhone = customerProfile.primaryPhone?.trim() ?? "";
    const currentAddress = (customerProfile.address ?? customerDisplayAddress ?? "").trim();
    return (
      nextDisplayName !== currentDisplayName ||
      nextPrimaryEmail !== currentPrimaryEmail ||
      nextPrimaryPhone !== currentPrimaryPhone ||
      nextAddress !== currentAddress
    );
  }, [
    customerAddressInput,
    customerDisplayAddress,
    customerDisplayNameInput,
    customerPrimaryEmailInput,
    customerPrimaryPhoneInput,
    customerProfile
  ]);

  const openCustomerEditor = useCallback(() => {
    setCustomerDisplayNameInput(customerProfile?.displayName?.trim() ?? ticket.requester_name);
    setCustomerPrimaryEmailInput(
      customerProfile?.primaryEmail ?? (ticket.requester_email.includes("@") ? ticket.requester_email : "")
    );
    setCustomerPrimaryPhoneInput(
      customerProfile?.primaryPhone ??
        (ticket.requester_email.startsWith("whatsapp:") || ticket.requester_email.startsWith("voice:")
          ? normalizeAddress(ticket.requester_email)
          : "")
    );
    setCustomerAddressInput((customerProfile?.address ?? customerDisplayAddress ?? "").trim());
    setCustomerProfileError(null);
    setCustomerEditorOpen(true);
  }, [
    customerDisplayAddress,
    customerProfile?.address,
    customerProfile?.displayName,
    customerProfile?.primaryEmail,
    customerProfile?.primaryPhone,
    ticket.requester_email,
    ticket.requester_name
  ]);

  const openMetadataEditor = useCallback(() => {
    setMetadataInput(JSON.stringify(ticket.metadata ?? {}, null, 2));
    setMetadataError(null);
    setMetadataEditorOpen(true);
  }, [ticket.metadata]);

  const submitReply = async () => {
    setComposerError(null);

    if (primaryChannel === "voice") {
      setComposerError("Voice tickets use the call workflow instead of text reply.");
      return;
    }

    const manualRecipientRaw = recipientOverrideInput.trim();
    const manualRecipient = manualRecipientRaw
      ? primaryChannel === "whatsapp"
        ? normalizeRecipientPhone(manualRecipientRaw)
        : normalizeRecipientEmail(manualRecipientRaw)
      : null;

    if (manualRecipientRaw && !manualRecipient) {
      setComposerError(
        primaryChannel === "whatsapp"
          ? "Enter a valid phone number for the recipient override."
          : "Enter a valid email address for the recipient override."
      );
      return;
    }

    const resolvedRecipient = manualRecipient ?? selectedRecipient;

    if (!resolvedRecipient) {
      setComposerError("No valid recipient found for this channel.");
      return;
    }

    const attachmentPayload = replyAttachments.map((attachment) => ({
      filename: attachment.filename,
      contentType: attachment.contentType,
      size: attachment.size,
      contentBase64: attachment.contentBase64
    }));

    let template: {
      name: string;
      language: string;
      components?: Array<Record<string, unknown>>;
    } | null = null;

    if (selectedTemplate) {
      if (selectedTemplateParamCount && templateParamList.length < selectedTemplateParamCount) {
        setComposerError(`Template requires at least ${selectedTemplateParamCount} parameter(s).`);
        return;
      }
      template = {
        name: selectedTemplate.name,
        language: selectedTemplate.language,
        components: templateParamList.length
          ? [
              {
                type: "body",
                parameters: templateParamList.map((param) => ({ type: "text", text: param }))
              }
            ]
          : selectedTemplate.components ?? undefined
      };
    }

    if (primaryChannel === "whatsapp" && whatsappWindow && !whatsappWindow.isOpen && !template) {
      setComposerError("WhatsApp 24h window is closed. Select a template.");
      return;
    }

    if (primaryChannel === "whatsapp" && attachmentPayload.length > 1) {
      setComposerError("WhatsApp supports one attachment per message.");
      return;
    }

    if (primaryChannel === "whatsapp" && attachmentPayload.length > 0 && template) {
      setComposerError("Templates cannot be combined with attachments.");
      return;
    }

    const text = replyText.trim();
    if (!text && !template && attachmentPayload.length === 0) {
      setComposerError(
        primaryChannel === "whatsapp"
          ? "Add a reply or provide a template."
          : "Reply body required."
      );
      return;
    }

    const success = await onSendReply({
      text: text || null,
      recipient: resolvedRecipient || null,
      template,
      attachments: attachmentPayload.length ? attachmentPayload : null
    });
    if (success) {
      setReplyText("");
      setReplyAttachments([]);
      setSelectedTemplateId("");
      setWaTemplateParams("");
      setRecipientOverrideOpen(false);
      setRecipientOverrideInput("");
      setComposerError(null);
    }
  };

  const saveMetadata = async () => {
    setMetadataError(null);
    try {
      const parsed = metadataInput.trim() ? JSON.parse(metadataInput) : {};
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        setMetadataError("Metadata must be a JSON object.");
        return;
      }
      await onTicketPatch({ metadata: parsed as Record<string, unknown> });
    } catch {
      setMetadataError("Metadata must be valid JSON.");
    }
  };

  const saveCustomerProfile = async () => {
    setCustomerProfileError(null);
    if (!customerProfile) {
      setCustomerProfileError("Customer profile is not linked yet.");
      return;
    }

    const nextDisplayName = customerDisplayNameInput.trim();
    const nextPrimaryEmail = customerPrimaryEmailInput.trim().toLowerCase();
    const nextPrimaryPhone = customerPrimaryPhoneInput.trim();
    const nextAddress = customerAddressInput.trim();
    const currentDisplayName = customerProfile.displayName?.trim() ?? "";
    const currentPrimaryEmail = customerProfile.primaryEmail?.trim().toLowerCase() ?? "";
    const currentPrimaryPhone = customerProfile.primaryPhone?.trim() ?? "";
    const currentAddress = (customerProfile.address ?? customerDisplayAddress ?? "").trim();

    const patch: {
      displayName?: string | null;
      primaryEmail?: string | null;
      primaryPhone?: string | null;
      address?: string | null;
    } = {};

    if (nextDisplayName !== currentDisplayName) {
      patch.displayName = nextDisplayName || null;
    }
    if (nextPrimaryEmail !== currentPrimaryEmail) {
      patch.primaryEmail = nextPrimaryEmail || null;
    }
    if (nextPrimaryPhone !== currentPrimaryPhone) {
      patch.primaryPhone = nextPrimaryPhone || null;
    }
    if (nextAddress !== currentAddress) {
      patch.address = nextAddress || null;
    }

    if (Object.keys(patch).length === 0) {
      setCustomerProfileError("No profile changes to save.");
      return;
    }

    const success = await onSaveCustomerProfile(patch);
    if (!success) {
      setCustomerProfileError("Could not save customer profile.");
      return;
    }
    setCustomerProfileError(null);
    setCustomerEditorOpen(false);
  };

  const addTag = async (value: string) => {
    const normalized = value.trim().toLowerCase();
    if (!normalized || ticket.tags.includes(normalized)) {
      setNewTag("");
      return;
    }
    await onAddTag(normalized);
    setNewTag("");
  };

  const handleAttachmentChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    if (files.length === 0) return;
    setComposerError(null);

    if (primaryChannel === "whatsapp" && replyAttachments.length >= 1) {
      setComposerError("WhatsApp supports one attachment per message.");
      event.target.value = "";
      return;
    }

    const limit = primaryChannel === "whatsapp" ? 1 : files.length;
    const nextFiles = files.slice(0, limit);

    try {
      const prepared = await encodeAttachments(nextFiles);

      setReplyAttachments((previous) =>
        primaryChannel === "whatsapp" ? prepared.slice(0, 1) : [...previous, ...prepared]
      );
    } catch {
      setComposerError("Failed to read attachment.");
    } finally {
      event.target.value = "";
    }
  };

  return (
    <>
      <div ref={detailLayoutRef} className="w-full h-full flex min-w-0">
        <div className="min-w-0 flex-1 bg-white flex flex-col">
          <div className="border-b border-neutral-200 p-6">
            <div className="flex items-start justify-between mb-4">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-sm font-medium text-neutral-600">{activeTimelineTicketIdValue}</span>
                  <Badge variant="outline" className="text-xs">
                    {toTitleCase(activeTimelineChannelValue)}
                  </Badge>
                </div>
                <h2 className="text-xl font-semibold mb-2">{ticket.subject}</h2>
                <p className="text-sm text-neutral-600">
                  {ticket.requester_name} • {ticket.requester_email}
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="gap-2"
                onClick={() => setShowHistory(true)}
                aria-label="Open history"
              >
                <Clock className="w-4 h-4" />
              </Button>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-2" disabled={ticketUpdating}>
                    Status: {ticket.status}
                    <ChevronDown className="w-3 h-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem onClick={() => onStatusChange("open")}>Open</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onStatusChange("pending")}>Pending</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onStatusChange("resolved")}>Resolved</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onStatusChange("closed")}>Closed</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-2" disabled={ticketUpdating}>
                    Priority: {ticket.priority}
                    <ChevronDown className="w-3 h-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem onClick={() => onPriorityChange("low")}>Low</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onPriorityChange("medium")}>Medium</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onPriorityChange("high")}>High</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onPriorityChange("urgent")}>Urgent</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          <div ref={mainColumnRef} className="flex-1 min-h-0 flex flex-col">
            <div
              ref={conversationScrollRef}
              className="flex-1 min-h-0 overflow-y-auto p-6"
              onScroll={syncActiveTimelineFromScroll}
            >
              <div className="mx-auto w-full max-w-[1120px] space-y-4">
                {detailLoading ? <p className="text-sm text-neutral-600">Loading conversation...</p> : null}
                {detailError ? <p className="text-sm text-red-600">{detailError}</p> : null}
                {!detailLoading && !detailError
                  ? conversationTimeline.map((item) =>
                      <div key={item.id} ref={(node) => registerTimelineItem(item.id, node)}>
                        {item.kind === "email-thread" ? (
                          <EmailThreadGroup messages={item.messages} />
                        ) : (
                          <ConversationMessageItem
                            message={item.message}
                            onResendWhatsApp={onResendWhatsApp}
                            resending={resendingMessageId === item.message.id}
                          />
                        )}
                      </div>
                    )
                  : null}
                {!detailLoading && !detailError && messages.length === 0 ? (
                  <div className="text-center py-8">
                    <p className="text-xs text-neutral-500">No messages yet</p>
                  </div>
                ) : null}
              </div>
            </div>

            <ResizeHandle orientation="horizontal" onPointerDown={startComposerResize} />

            <div
              className="shrink-0 border-t border-neutral-200 bg-white"
              style={{ height: composerHeight }}
            >
              <div className="h-full overflow-y-auto p-4">
                <div className="mx-auto w-full max-w-[1120px]">
              {draft && showAIDraft ? (
                <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 p-4">
                  <div className="flex items-start gap-3">
                    <Sparkles className="mt-0.5 h-5 w-5 text-blue-600" />
                    <div className="flex-1">
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="text-sm font-medium text-blue-900">AI Suggested Reply</h4>
                        {draft.confidence !== null ? (
                          <Badge variant="secondary" className="text-xs">
                            {Math.round(draft.confidence * 100)}% confident
                          </Badge>
                        ) : null}
                      </div>
                      <p className="mb-3 whitespace-pre-wrap text-sm text-blue-800">
                        {draft.suggested_body}
                      </p>
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          disabled={draftUpdating}
                          onClick={() => {
                            setReplyText(draft.suggested_body);
                            setShowAIDraft(false);
                            void onUseDraft(draft.id);
                          }}
                        >
                          Use Draft
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={draftUpdating}
                          onClick={() => {
                            setShowAIDraft(false);
                            void onDismissDraft(draft.id);
                          }}
                        >
                          Dismiss
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}

              <div className="mb-3 flex items-center gap-2">
                <Button variant="outline" size="sm">
                  Reply
                </Button>
                {ticket.has_whatsapp ? (
                  <Button variant="outline" size="sm">
                    WhatsApp
                  </Button>
                ) : null}
                {ticket.has_voice ? (
                  <Button variant="outline" size="sm" className="gap-2" onClick={onOpenVoiceCall}>
                    <Phone className="w-4 h-4" />
                    Voice Call
                  </Button>
                ) : null}
              </div>

              {primaryChannel !== "voice" ? (
                <div className="mb-3 space-y-3 rounded-lg border border-neutral-200 bg-neutral-50 p-3">
                  {primaryChannel === "whatsapp" && whatsappWindow ? (
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-medium text-neutral-700">WhatsApp 24h window</p>
                      <Badge variant="outline" className="text-[11px]">
                        {whatsappWindow.isOpen
                          ? `Open • ${whatsappWindow.minutesRemaining}m left`
                          : "Closed • template required"}
                      </Badge>
                    </div>
                  ) : null}

                  <div className="rounded-lg border border-neutral-200 bg-white">
                    <button
                      type="button"
                      className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left"
                      onClick={() => setRecipientOverrideOpen((current) => !current)}
                    >
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-neutral-700">Recipient override</p>
                        <p className="truncate text-[11px] text-neutral-500">
                          {defaultRecipientOption
                            ? `Default: ${defaultRecipientOption.value}`
                            : "No default recipient available"}
                        </p>
                      </div>
                      <ChevronDown
                        className={cn(
                          "h-4 w-4 shrink-0 text-neutral-400 transition-transform",
                          recipientOverrideOpen && "rotate-180"
                        )}
                      />
                    </button>

                    {recipientOverrideOpen ? (
                      <div className="border-t border-neutral-200 px-3 py-3">
                        <div className="grid gap-2">
                          <Input
                            className="h-8 text-xs"
                            value={recipientOverrideInput}
                            onChange={(event) => {
                              setRecipientOverrideInput(event.target.value);
                              setComposerError(null);
                            }}
                            placeholder={
                              primaryChannel === "whatsapp"
                                ? "+15551234567"
                                : "customer@example.com"
                            }
                          />
                          <p className="text-[11px] text-neutral-500">
                            Leave blank to use the default recipient for this ticket.
                          </p>
                        </div>

                        {recipientSuggestions.length > 0 ? (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {recipientSuggestions.map((option) => (
                              <button
                                key={option.value}
                                type="button"
                                className="rounded-full border border-neutral-200 bg-neutral-50 px-2 py-1 text-[10px] text-neutral-700 transition-colors hover:bg-neutral-100"
                                onClick={() => {
                                  setRecipientOverrideInput(option.value);
                                  setComposerError(null);
                                }}
                              >
                                {option.label} • {option.value}
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>

                  {primaryChannel === "whatsapp" ? (
                    <div className="grid gap-2">
                      <label className="text-xs font-medium text-neutral-600">Template</label>
                      <select
                        className="h-9 rounded-md border border-neutral-200 bg-white px-3 text-sm"
                        value={selectedTemplateId}
                        onChange={(event) => {
                          setSelectedTemplateId(event.target.value);
                          setComposerError(null);
                        }}
                      >
                        <option value="">No template</option>
                        {whatsAppTemplates.map((template) => (
                          <option key={template.id} value={template.id}>
                            {template.name} ({template.language})
                          </option>
                        ))}
                      </select>

                      {(selectedTemplateId || (whatsappWindow && !whatsappWindow.isOpen)) ? (
                        <div className="grid gap-2">
                          <Input
                            value={waTemplateParams}
                            onChange={(event) => setWaTemplateParams(event.target.value)}
                            placeholder="Template params, comma separated"
                          />
                          {selectedTemplateParamCount ? (
                            <p className="text-xs text-neutral-500">
                              Requires at least {selectedTemplateParamCount} parameter(s).
                              {missingTemplateParams > 0 ? ` Missing ${missingTemplateParams}.` : ""}
                            </p>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : null}

              <Textarea
                placeholder={
                  primaryChannel === "voice" ? "Voice tickets use the call workflow." : "Type your reply..."
                }
                className="resize-none"
                rows={4}
                value={replyText}
                onChange={(event) => setReplyText(event.target.value)}
                disabled={primaryChannel === "voice"}
              />

              {replyAttachments.length > 0 ? (
                <div className="mt-3 space-y-2">
                  {replyAttachments.map((attachment) => (
                    <div
                      key={attachment.id}
                      className="flex items-center justify-between rounded-lg border border-neutral-200 bg-white px-3 py-2"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-xs font-medium text-neutral-900">{attachment.filename}</p>
                        <p className="text-xs text-neutral-500">{formatFileSize(attachment.size)}</p>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          setReplyAttachments((previous) =>
                            previous.filter((entry) => entry.id !== attachment.id)
                          )
                        }
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              ) : null}

              <div className="flex items-center justify-between mt-3">
                <div className="flex items-center gap-2">
                  <label className="inline-flex">
                    <input
                      type="file"
                      className="hidden"
                      multiple={primaryChannel !== "whatsapp"}
                      onChange={(event) => {
                        void handleAttachmentChange(event);
                      }}
                      disabled={primaryChannel === "voice"}
                    />
                    <span className="inline-flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm transition-colors hover:bg-accent hover:text-accent-foreground">
                      <Upload className="h-4 w-4" />
                      Attach
                    </span>
                  </label>
                  <Button variant="ghost" size="sm" onClick={() => setShowMacroPicker(true)}>
                    Macro
                  </Button>
                </div>
                <Button
                  size="sm"
                  disabled={
                    replySending ||
                    primaryChannel === "voice" ||
                    (replyRecipientOptions.length === 0 && !recipientOverrideInput.trim())
                  }
                  onClick={() => void submitReply()}
                >
                  {replySending
                    ? "Sending..."
                    : primaryChannel === "whatsapp"
                      ? "Send WhatsApp"
                      : "Send"}
                </Button>
              </div>
              {displayReplyError ? <p className="mt-2 text-xs text-red-600">{displayReplyError}</p> : null}
                </div>
              </div>
            </div>
          </div>
        </div>

        <ResizeHandle orientation="vertical" onPointerDown={startDetailSidebarResize} />

        <div
          className="shrink-0 bg-white overflow-y-auto p-6"
          style={{ width: detailSidebarWidth }}
        >
          <h3 className="mb-4 font-semibold">Customer Details</h3>

          <div className="mb-6 rounded-xl border border-neutral-200 bg-neutral-50 p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-100 font-medium text-blue-700">
                  {customerDisplayName.charAt(0)}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-neutral-900">{customerDisplayName}</p>
                  {customerProfile?.kind ? (
                    <Badge variant="outline" className="mt-2 h-5 text-[10px]">
                      {customerProfile.kind === "registered" ? "Registered profile" : "Unregistered profile"}
                    </Badge>
                  ) : null}
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="h-8 px-3 text-xs"
                disabled={!customerProfile}
                onClick={openCustomerEditor}
              >
                Edit
              </Button>
            </div>
            <div className="mt-4 border-t border-neutral-200 pt-4">
              <h4 className="mb-2 text-xs font-medium text-neutral-600">Contact Details</h4>
              <div className="space-y-2">
                <div className="flex items-start justify-between gap-3 text-xs">
                  <span className="text-neutral-500">Email</span>
                  <span className="max-w-[170px] break-words text-right text-neutral-900">
                    {customerDisplayEmail ?? "No email"}
                  </span>
                </div>
                <div className="flex items-start justify-between gap-3 text-xs">
                  <span className="text-neutral-500">Phone</span>
                  <span className="max-w-[170px] break-words text-right text-neutral-900">
                    {customerDisplayPhone ?? "No phone"}
                  </span>
                </div>
                <div className="flex items-start justify-between gap-3 text-xs">
                  <span className="text-neutral-500">Address</span>
                  <span className="max-w-[170px] break-words text-right text-neutral-900">
                    {customerDisplayAddress ?? "No address"}
                  </span>
                </div>
              </div>
            </div>
            {!customerProfile ? (
              <p className="mt-3 text-xs text-neutral-500">Customer profile is not linked yet.</p>
            ) : null}
          </div>

          <div className="mb-6">
            <h4 className="mb-2 text-xs font-medium text-neutral-600">Interaction History</h4>
            <div className="space-y-2">
              {interactionHistoryRows.length === 0 ? (
                <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs text-neutral-500">
                  No omnichannel ticket history yet.
                </div>
              ) : (
                interactionHistoryRows.map((historyItem) => {
                  const isCurrentTicket = historyItem.ticketId === activeTimelineTicketIdValue;
                  return (
                    <button
                      key={historyItem.ticketId}
                      type="button"
                      className={cn(
                        "w-full rounded-lg border px-3 py-2 text-left transition-colors",
                        isCurrentTicket
                          ? "border-blue-300 bg-blue-50"
                          : "border-neutral-200 bg-white hover:bg-neutral-50"
                      )}
                      onClick={() => {
                        pendingTimelineFocusTicketIdRef.current = historyItem.ticketId;
                        pendingTimelineFocusBehaviorRef.current = "smooth";
                        if (historyItem.ticketId === ticket.id) {
                          scrollTimelineToTicketId(historyItem.ticketId, "smooth");
                          return;
                        }
                        onSelectHistoryTicket(historyItem.ticketId);
                      }}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-medium text-neutral-800">{historyItem.ticketId}</p>
                          <p className="mt-0.5 truncate text-xs text-neutral-600">{historyItem.subject}</p>
                          <div className="mt-1 flex items-center gap-1.5">
                            <Badge variant="outline" className="h-5 border-neutral-200 text-[10px]">
                              {toTitleCase(historyItem.channel)}
                            </Badge>
                            <Badge
                              variant="outline"
                              className={cn("h-5 text-[10px]", getHistoryStatusColor(historyItem.status))}
                            >
                              {toTitleCase(historyItem.status)}
                            </Badge>
                            {isCurrentTicket ? (
                              <Badge variant="outline" className="h-5 border-blue-300 text-[10px] text-blue-700">
                                Current
                              </Badge>
                            ) : null}
                          </div>
                        </div>
                        <span className="whitespace-nowrap text-[11px] text-neutral-500">
                          {formatDateRelative(historyItem.lastActivityAt)}
                        </span>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {linkedCaseRows.length > 0 ? (
            <div className="mb-6">
              <h4 className="mb-2 text-xs font-medium text-neutral-600">Linked Cases</h4>
              <div className="space-y-2">
                {linkedCaseRows.map((linkedItem) => {
                  const isCurrentTicket = linkedItem.ticketId === activeTimelineTicketIdValue;
                  return (
                    <button
                      key={linkedItem.linkId}
                      type="button"
                      className={cn(
                        "w-full rounded-lg border px-3 py-2 text-left transition-colors",
                        isCurrentTicket
                          ? "border-blue-300 bg-blue-50"
                          : "border-neutral-200 bg-white hover:bg-neutral-50"
                      )}
                      onClick={() => {
                        pendingTimelineFocusTicketIdRef.current = linkedItem.ticketId;
                        pendingTimelineFocusBehaviorRef.current = "smooth";
                        if (linkedItem.ticketId === ticket.id) {
                          scrollTimelineToTicketId(linkedItem.ticketId, "smooth");
                          return;
                        }
                        onSelectHistoryTicket(linkedItem.ticketId);
                      }}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-medium text-neutral-800">{linkedItem.ticketId}</p>
                          <p className="mt-0.5 truncate text-xs text-neutral-600">{linkedItem.subject}</p>
                          <div className="mt-1 flex flex-wrap items-center gap-1.5">
                            <Badge variant="outline" className="h-5 border-neutral-200 text-[10px]">
                              {toTitleCase(linkedItem.channel)}
                            </Badge>
                            <Badge
                              variant="outline"
                              className={cn("h-5 text-[10px]", getHistoryStatusColor(linkedItem.status))}
                            >
                              {toTitleCase(linkedItem.status)}
                            </Badge>
                            <Badge variant="outline" className="h-5 border-purple-200 bg-purple-50 text-[10px] text-purple-700">
                              Linked case
                            </Badge>
                            {isCurrentTicket ? (
                              <Badge variant="outline" className="h-5 border-blue-300 text-[10px] text-blue-700">
                                Current
                              </Badge>
                            ) : null}
                          </div>
                          {linkedItem.reason ? (
                            <p className="mt-1 line-clamp-2 text-[11px] text-neutral-500">{linkedItem.reason}</p>
                          ) : null}
                        </div>
                        <span className="whitespace-nowrap text-[11px] text-neutral-500">
                          {formatDateRelative(linkedItem.linkedAt)}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          <div className="mb-6">
            <div className="mb-2 flex items-center gap-2">
              <Tag className="h-4 w-4 text-neutral-400" />
              <h4 className="text-xs font-medium text-neutral-600">Tags</h4>
            </div>
            <div className="mb-3 flex flex-wrap gap-1.5">
              {ticket.tags.length > 0 ? (
                ticket.tags.map((tag) => (
                  <div
                    key={tag}
                    className="inline-flex items-center gap-1 rounded-full border border-neutral-200 bg-white px-1.5 py-0.5 text-[10px]"
                  >
                    <span>{tag}</span>
                    <button
                      type="button"
                      className="text-neutral-400 transition-colors hover:text-neutral-900"
                      onClick={() => {
                        void onRemoveTag(tag);
                      }}
                      disabled={ticketUpdating}
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  </div>
                ))
              ) : (
                <span className="text-xs text-neutral-500">No tags</span>
              )}
            </div>
            <div className="flex gap-2">
              <Input
                className="h-7 text-[11px]"
                value={newTag}
                onChange={(event) => setNewTag(event.target.value)}
                placeholder="Add tag"
                disabled={ticketUpdating}
              />
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-2.5 text-[11px]"
                disabled={ticketUpdating || !newTag.trim()}
                onClick={() => {
                  void addTag(newTag);
                }}
              >
                Add
              </Button>
            </div>
            {tagSuggestions.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {tagSuggestions.map((candidate) => (
                  <Button
                    key={candidate.id}
                    variant="outline"
                    size="sm"
                    className="h-5 px-2 text-[10px]"
                    onClick={() => {
                      void addTag(candidate.name);
                    }}
                  >
                    {candidate.name}
                  </Button>
                ))}
              </div>
            ) : null}
          </div>

          <div className="mb-6">
            <div className="mb-2 flex items-center gap-2">
              <UserRound className="h-4 w-4 text-neutral-400" />
              <h4 className="text-xs font-medium text-neutral-600">Ownership</h4>
            </div>
            {currentUser?.role_name === "lead_admin" ? (
              <div>
                <label className="mb-1 block text-[11px] font-medium text-neutral-600">Assigned user</label>
                <select
                  className="h-8 w-full rounded-md border border-neutral-200 bg-white px-3 text-[11px]"
                  value={selectedAssigneeId}
                  onChange={async (event) => {
                    const nextAssigneeId = event.target.value;
                    setSelectedAssigneeId(nextAssigneeId);
                    if (nextAssigneeId === (ticket.assigned_user_id ?? "")) {
                      return;
                    }
                    const success = await onTicketPatch({ assignedUserId: nextAssigneeId || null });
                    if (!success) {
                      setSelectedAssigneeId(ticket.assigned_user_id ?? "");
                    }
                  }}
                  disabled={ticketUpdating}
                >
                  <option value="">Unassigned</option>
                  {assigneeOptions.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.display_name} ({user.email})
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2">
                <p className="text-[11px] uppercase tracking-[0.08em] text-neutral-500">Assigned user</p>
                <p className="mt-1 text-[11px] text-neutral-700">{ticket.assigned_user_name ?? "Unassigned"}</p>
              </div>
            )}
          </div>

          <div className="mb-6">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h4 className="text-xs font-medium text-neutral-600">Metadata</h4>
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-2.5 text-[11px]"
                onClick={openMetadataEditor}
              >
                Edit Metadata
              </Button>
            </div>
            <div className="space-y-2 rounded-lg border border-neutral-200 bg-neutral-50 p-3">
              {metadataEntries.length > 0 ? (
                metadataEntries.map(([key, value]) => (
                  <div key={key} className="flex justify-between gap-4 text-xs">
                    <span className="text-neutral-600">{key}:</span>
                    <span className="text-right text-neutral-900">{String(value)}</span>
                  </div>
                ))
              ) : (
                <span className="text-xs text-neutral-500">No metadata</span>
              )}
            </div>
          </div>

          <div>
            <h4 className="mb-2 text-xs font-medium text-neutral-600">Recent Activity</h4>
            <div className="space-y-3">
              <div className="text-xs">
                <p className="mb-1 text-neutral-600">Ticket created</p>
                <p className="text-neutral-500">{new Date(ticket.created_at).toLocaleString()}</p>
              </div>
              <div className="text-xs">
                <p className="mb-1 text-neutral-600">Last updated</p>
                <p className="text-neutral-500">{new Date(ticket.updated_at).toLocaleString()}</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <Dialog open={customerEditorOpen} onOpenChange={setCustomerEditorOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Update Info</DialogTitle>
            <DialogDescription>Update the linked customer profile for this conversation.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-neutral-600">Name</label>
              <Input
                value={customerDisplayNameInput}
                onChange={(event) => setCustomerDisplayNameInput(event.target.value)}
                placeholder="Customer name"
                disabled={customerProfileUpdating || !customerProfile}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-neutral-600">Primary email</label>
              <Input
                value={customerPrimaryEmailInput}
                onChange={(event) => setCustomerPrimaryEmailInput(event.target.value)}
                placeholder="customer@example.com"
                disabled={customerProfileUpdating || !customerProfile}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-neutral-600">Primary phone</label>
              <Input
                value={customerPrimaryPhoneInput}
                onChange={(event) => setCustomerPrimaryPhoneInput(event.target.value)}
                placeholder="+15551234567"
                disabled={customerProfileUpdating || !customerProfile}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-neutral-600">Address</label>
              <Textarea
                rows={3}
                value={customerAddressInput}
                onChange={(event) => setCustomerAddressInput(event.target.value)}
                placeholder="Customer address"
                disabled={customerProfileUpdating || !customerProfile}
              />
            </div>
            {customerProfileError ? <p className="text-xs text-red-600">{customerProfileError}</p> : null}
          </div>
          <DialogFooter>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              disabled={customerProfileUpdating || !customerProfile || !customerProfileDirty}
              onClick={() => {
                void saveCustomerProfile();
              }}
            >
              <Save className="h-3.5 w-3.5" />
              {customerProfileUpdating ? "Saving..." : "Save Profile"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={metadataEditorOpen} onOpenChange={setMetadataEditorOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit Metadata</DialogTitle>
            <DialogDescription>Adjust the raw ticket metadata JSON for this conversation.</DialogDescription>
          </DialogHeader>
          <div>
            <Textarea
              rows={12}
              className="font-mono text-xs"
              value={metadataInput}
              onChange={(event) => setMetadataInput(event.target.value)}
              disabled={ticketUpdating}
            />
            {metadataError ? <p className="mt-2 text-xs text-red-600">{metadataError}</p> : null}
          </div>
          <DialogFooter>
            <Button size="sm" variant="outline" disabled={ticketUpdating} onClick={() => void saveMetadata()}>
              Save Metadata
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <HistoryModal
        open={showHistory}
        onClose={() => setShowHistory(false)}
        ticketEvents={events}
        auditEvents={auditEvents}
      />

      <MacroPickerModal
        open={showMacroPicker}
        onClose={() => setShowMacroPicker(false)}
        macros={macros}
        query={macroQuery}
        onQueryChange={setMacroQuery}
        onInsert={(macro) => {
          setReplyText((previous) => (previous ? `${previous}\n\n${macro.body}` : macro.body));
          setShowMacroPicker(false);
        }}
      />
    </>
  );
}

function ConversationMessageItem({
  message,
  onResendWhatsApp,
  resending
}: {
  message: ConversationMessage;
  onResendWhatsApp: (messageId: string) => Promise<void>;
  resending: boolean;
}) {
  const [showTranscript, setShowTranscript] = useState(false);
  const attachments = message.attachments ?? [];
  const isFailedWhatsApp =
    message.channel === "whatsapp" &&
    message.direction === "outbound" &&
    (message.whatsapp_status ?? "").toLowerCase() === "failed";

  if (message.channel === "email") {
    return <EmailThreadGroup messages={[message]} />;
  }

  if (message.channel === "whatsapp") {
    return (
      <div className={cn("flex", message.direction === "outbound" ? "justify-end" : "justify-start")}>
        <div
          className={cn(
            "max-w-[88%] rounded-lg p-3",
            message.direction === "outbound"
              ? "border border-neutral-200 bg-white text-neutral-900 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-50"
              : "border border-green-300 bg-white text-neutral-900 dark:border-green-500/70 dark:bg-neutral-950 dark:text-neutral-50"
          )}
        >
          <div className="mb-1 flex items-center gap-2">
            <span className="text-xs font-medium">{message.from.name}</span>
            <Badge
              variant="outline"
              className={cn(
                "text-xs",
                message.direction === "outbound"
                  ? "border-neutral-300 text-neutral-700 dark:border-neutral-700 dark:text-neutral-200"
                  : "border-green-300 text-green-700 dark:border-green-500/70 dark:text-green-200"
              )}
            >
              WhatsApp
            </Badge>
            {message.is_template ? (
              <Badge
                variant="outline"
                className={cn(
                  "text-xs",
                  message.direction === "outbound"
                    ? "border-neutral-300 text-neutral-700 dark:border-neutral-700 dark:text-neutral-200"
                    : "border-green-300 text-green-700 dark:border-green-500/70 dark:text-green-200"
                )}
              >
                Template
              </Badge>
            ) : null}
          </div>

          <p className="mb-2 whitespace-pre-wrap text-sm">{message.body}</p>

          {attachments.length > 0 ? (
            <div className="mb-2 space-y-2">
              {attachments.map((attachment) => (
                <a
                  key={attachment.id}
                  href={`/api/attachments/${attachment.id}`}
                  className={cn(
                    "flex items-center gap-2 rounded-md border px-2 py-1.5 text-xs transition-colors",
                    message.direction === "outbound"
                      ? "border-neutral-200 bg-transparent text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800/60"
                      : "border-green-200 bg-transparent text-green-700 hover:bg-green-50 dark:border-green-500/60 dark:text-green-200 dark:hover:bg-green-500/10"
                  )}
                >
                  <Paperclip className="h-3 w-3" />
                  <span className="truncate">{attachment.filename}</span>
                </a>
              ))}
            </div>
          ) : null}

          <div className="flex items-center justify-between gap-2">
            <span className="text-xs opacity-70">{formatDateRelative(message.timestamp)}</span>
            {message.whatsapp_status ? (
              <div className="flex items-center gap-1">
                {whatsappStatusIcon(message.whatsapp_status)}
              </div>
            ) : null}
          </div>

          {isFailedWhatsApp ? (
            <div className="mt-3 flex justify-end">
              <Button
                variant={message.direction === "outbound" ? "secondary" : "outline"}
                size="sm"
                className="h-7 gap-2 text-xs"
                disabled={resending}
                onClick={() => {
                  void onResendWhatsApp(message.id);
                }}
              >
                <RefreshCw className={cn("h-3 w-3", resending && "animate-spin")} />
                {resending ? "Queueing..." : "Resend"}
              </Button>
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  if (message.channel === "voice") {
    return (
      <div className="w-full rounded-lg border border-neutral-200 bg-white p-4">
        <div className="mb-3 flex items-start gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-green-100">
            <PhoneCall className="h-4 w-4 text-green-700" />
          </div>
          <div className="flex-1">
            <div className="mb-1 flex items-center gap-2">
              <span className="text-sm font-medium">
                {message.direction === "outbound" ? "Outbound Call" : "Inbound Call"}
              </span>
              <Badge variant="outline" className="text-xs">
                Voice
              </Badge>
              {message.call_status ? (
                <Badge
                  variant="outline"
                  className="border-green-200 bg-green-50 text-xs text-green-700 dark:border-green-500/40 dark:bg-green-500/10 dark:text-green-200"
                >
                  {toTitleCase(message.call_status)}
                </Badge>
              ) : null}
            </div>
            <p className="text-xs text-neutral-600">
              {message.from.name} → {message.to.name}
            </p>
            <p className="text-xs text-neutral-500">{formatDateRelative(message.timestamp)}</p>
          </div>
        </div>

        <div className="space-y-2">
          {typeof message.call_duration === "number" ? (
            <div className="flex items-center gap-4 text-sm">
              <div className="flex items-center gap-2">
                <Phone className="w-4 h-4 text-neutral-400" />
                <span className="text-neutral-700">Duration: {formatDuration(message.call_duration)}</span>
              </div>
            </div>
          ) : null}

          {message.call_outcome ? (
            <div className="rounded bg-neutral-50 p-3 text-sm text-neutral-700">
              <strong>Outcome:</strong> {message.call_outcome}
            </div>
          ) : null}

          {message.transcript ? (
            <>
              <Separator />
              <Button
                variant="ghost"
                size="sm"
                className="w-full gap-2"
                onClick={() => setShowTranscript(!showTranscript)}
              >
                {showTranscript ? "Hide" : "Show"} Transcript
                <ChevronDown
                  className={cn("h-4 w-4 transition-transform", showTranscript && "rotate-180")}
                />
              </Button>
              {showTranscript ? (
                <div className="whitespace-pre-wrap rounded bg-neutral-50 p-3 text-xs text-neutral-700">
                  {message.transcript}
                </div>
              ) : null}
            </>
          ) : null}

          {message.recording_url ? (
            <a href={message.recording_url} target="_blank" rel="noreferrer" className="block">
              <Button variant="outline" size="sm" className="w-full gap-2" type="button">
                <Play className="w-4 h-4" />
                Play Recording
              </Button>
            </a>
          ) : null}
        </div>
      </div>
    );
  }

  return null;
}

function EmailThreadGroup({ messages }: { messages: ConversationMessage[] }) {
  return (
    <div className="w-full rounded-lg border border-neutral-200 bg-white p-4">
      <div className="space-y-4">
        {messages.map((message, index) => (
          <div
            key={message.id}
            className={cn(index > 0 ? "border-t border-neutral-200 pt-4" : undefined)}
          >
            <EmailThreadMessage message={message} />
          </div>
        ))}
      </div>
    </div>
  );
}

function EmailThreadMessage({ message }: { message: ConversationMessage }) {
  const attachments = message.attachments ?? [];

  return (
    <>
      <div className="mb-3 flex items-start gap-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-100 text-sm font-medium text-blue-700">
          {message.from.name.charAt(0)}
        </div>
        <div className="flex-1">
          <div className="mb-1 flex items-center gap-2">
            <span className="text-sm font-medium">{message.from.name}</span>
            {message.from.email ? (
              <span className="text-xs text-neutral-500">{message.from.email}</span>
            ) : null}
            <Badge variant="outline" className="text-xs">
              Email
            </Badge>
          </div>
          <p className="text-xs text-neutral-500">{formatDateRelative(message.timestamp)}</p>
        </div>
      </div>

      <div className="whitespace-pre-wrap text-sm leading-relaxed text-neutral-700">{message.body}</div>

      {attachments.length > 0 ? (
        <div className="mt-4 space-y-2 border-t border-neutral-200 pt-3">
          {attachments.map((attachment) => (
            <a
              key={attachment.id}
              href={`/api/attachments/${attachment.id}`}
              className="flex items-center gap-3 rounded-lg border border-neutral-200 px-3 py-2 transition-colors hover:bg-neutral-50"
            >
              <Paperclip className="h-4 w-4 text-neutral-400" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium text-neutral-900">{attachment.filename}</p>
                <p className="text-xs text-neutral-500">{formatFileSize(attachment.sizeBytes)}</p>
              </div>
            </a>
          ))}
        </div>
      ) : null}
    </>
  );
}
