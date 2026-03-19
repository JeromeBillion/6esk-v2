import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Search,
  Filter,
  Plus,
  ChevronDown,
  MoreHorizontal,
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
  type SupportSavedView,
  type SupportMacro,
  type TicketCallOptions
} from "@/app/lib/api/support";
import { listActiveWhatsAppTemplates, type ActiveWhatsAppTemplate } from "@/app/lib/api/whatsapp";
import { getCurrentSessionUser, type CurrentSessionUser } from "@/app/lib/api/session";
import { listTags, listUsers, type AdminUserRecord, type TagRecord } from "@/app/lib/api/admin";
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
  preview: string;
  unread: boolean;
};

type ConversationMessage = {
  id: string;
  channel: "email" | "whatsapp" | "voice";
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

type CustomerProfileView = {
  id: string;
  kind: "registered" | "unregistered";
  displayName: string | null;
  primaryEmail: string | null;
  primaryPhone: string | null;
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

type SavedViewFilters = SupportSavedView["filters"];

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
    preview: subject,
    unread: false
  };
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
  const paramsKey = searchParams.toString();
  const [currentUser, setCurrentUser] = useState<CurrentSessionUser | null>(null);
  const [assigneeOptions, setAssigneeOptions] = useState<AdminUserRecord[]>([]);
  const [supportMacros, setSupportMacros] = useState<SupportMacro[]>([]);
  const [whatsAppTemplates, setWhatsAppTemplates] = useState<ActiveWhatsAppTemplate[]>([]);
  const [tickets, setTickets] = useState<TicketView[]>([]);
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

  const [conversationMessages, setConversationMessages] = useState<ConversationMessage[]>([]);
  const [ticketEvents, setTicketEvents] = useState<HistoryTicketEvent[]>([]);
  const [auditEvents, setAuditEvents] = useState<HistoryAuditEvent[]>([]);
  const [customerProfile, setCustomerProfile] = useState<CustomerProfileView | null>(null);
  const [customerTicketHistory, setCustomerTicketHistory] = useState<CustomerTicketHistoryItem[]>([]);
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
  const [feedback, setFeedback] = useState<FeedbackState>({
    open: false,
    tone: "info",
    title: "",
    message: ""
  });

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
        const nextTickets = (
          await listTickets({
            status: statusFilter === "all" ? undefined : (statusFilter as "open" | "pending" | "resolved" | "closed"),
            priority: priorityFilter === "all" ? undefined : priorityFilter,
            tag: tagFilter === "all" ? undefined : tagFilter,
            channel: channelFilter === "all" ? undefined : channelFilter,
            assigned: assignedMine ? "mine" : undefined,
            query: searchQuery.trim() || undefined,
            signal
          })
        ).map(mapTicket);
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

      const mappedMessages = details.messages
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
            channel: message.channel,
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

      const currentTicket = mapTicket(details.ticket);
      const primaryChannel = inferPrimaryChannel(currentTicket, mappedMessages);
      const primaryMessages = mappedMessages.filter((message) => message.channel === primaryChannel);
      setConversationMessages(primaryMessages.length > 0 ? primaryMessages : mappedMessages);
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
      setTicketEvents([]);
      setAuditEvents([]);
      setCustomerProfile(null);
      setCustomerTicketHistory([]);
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

  useEffect(() => {
    if (!selectedTicketId) {
      setConversationMessages([]);
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
      if (!selectedTicketId) return;
      setTicketUpdating(true);
      setReplyError(null);
      try {
        const payload = await patchTicket(selectedTicketId, patch);
        setTickets((previous) =>
          previous.map((ticket) => (ticket.id === selectedTicketId ? mapTicket(payload.ticket) : ticket))
        );
        await loadTicketDetails(selectedTicketId);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to update ticket";
        setReplyError(message);
        openFeedback({
          tone: "error",
          title: "Ticket update failed",
          message
        });
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
      <div className="h-full flex">
        {/* Ticket Queue */}
        <div className="w-[480px] border-r border-neutral-200 bg-white flex flex-col">
          {/* Header */}
          <div className="border-b border-neutral-200 p-4 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h1 className="text-lg font-semibold">Support</h1>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" className="gap-2" onClick={() => router.push("/tickets/merge-reviews")}>
                  <GitMerge className="w-4 h-4" />
                  Reviews
                </Button>
                <Button size="sm" className="gap-2" onClick={() => router.push("/tickets/new")}>
                  <Plus className="w-4 h-4" />
                  New Ticket
                </Button>
              </div>
            </div>

            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" />
              <Input
                placeholder="Search tickets..."
                className="pl-9"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            {/* Filters */}
            <div className="flex flex-wrap items-center gap-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-2">
                    <Filter className="w-4 h-4" />
                    Status: {statusFilter === 'all' ? 'All' : statusFilter}
                    <ChevronDown className="w-3 h-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuItem onClick={() => setStatusFilter('all')}>All</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setStatusFilter('open')}>Open</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setStatusFilter('pending')}>
                    Pending
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setStatusFilter('resolved')}>
                    Resolved
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setStatusFilter('closed')}>
                    Closed
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-2">
                    Priority: {priorityFilter === "all" ? "All" : priorityFilter}
                    <ChevronDown className="w-3 h-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuItem onClick={() => setPriorityFilter("all")}>All</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setPriorityFilter("low")}>Low</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setPriorityFilter("medium")}>Medium</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setPriorityFilter("high")}>High</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setPriorityFilter("urgent")}>Urgent</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-2">
                    Channel: {channelFilter === "all" ? "All" : toTitleCase(channelFilter)}
                    <ChevronDown className="w-3 h-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuItem onClick={() => setChannelFilter("all")}>All</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setChannelFilter("email")}>Email</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setChannelFilter("whatsapp")}>WhatsApp</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setChannelFilter("voice")}>Voice</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-2">
                    Tag: {tagFilter === "all" ? "All" : tagFilter}
                    <ChevronDown className="w-3 h-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuItem onClick={() => setTagFilter("all")}>All</DropdownMenuItem>
                  {availableTags.map((tag) => (
                    <DropdownMenuItem key={tag.id} onClick={() => setTagFilter(tag.name)}>
                      {tag.name}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>

              <Button
                variant={assignedMine ? "default" : "outline"}
                size="sm"
                className="ml-auto"
                onClick={() => setAssignedMine((previous) => !previous)}
              >
                {assignedMine ? "Assigned: Mine" : "Assigned: Any"}
              </Button>

              <Button
                variant="outline"
                size="sm"
                onClick={() => setSavedViewsOpen(true)}
              >
                Saved Views{activeSavedViewId ? " • Active" : ""}
              </Button>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-2">
                    <GitMerge className="w-4 h-4" />
                    Merge
                    <ChevronDown className="w-3 h-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuItem
                    onClick={() => {
                      setMergeType("ticket");
                      setShowMergeModal(true);
                    }}
                  >
                    Merge Tickets
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

              {selectedTickets.size > 0 && (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-neutral-600">{selectedTickets.size} selected</span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setBulkActionsOpen(true)}
                  >
                    Bulk Actions
                  </Button>
                </div>
              )}
            </div>
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
              tickets.map((ticket) => (
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
                    <p className="text-xs text-neutral-500 line-clamp-2 mb-3">{ticket.preview}</p>

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
            ))}

            {!queueLoading && !queueError && tickets.length === 0 && (
              <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
                <p className="text-neutral-600 mb-1">No tickets found</p>
                <p className="text-xs text-neutral-500">Try adjusting your filters</p>
              </div>
            )}
          </div>
        </div>

        {/* Ticket Detail */}
        <div className="flex-1 bg-neutral-50 flex items-center justify-center">
          {selectedTicket ? (
            <TicketDetail
              ticket={selectedTicket}
              messages={conversationMessages}
              events={ticketEvents}
              auditEvents={auditEvents}
              customerProfile={customerProfile}
              customerTicketHistory={customerTicketHistory}
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
                await updateTicket(patch);
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
  events,
  auditEvents,
  customerProfile,
  customerTicketHistory,
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
  events: HistoryTicketEvent[];
  auditEvents: HistoryAuditEvent[];
  customerProfile: CustomerProfileView | null;
  customerTicketHistory: CustomerTicketHistoryItem[];
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
  }) => Promise<void>;
  onSaveCustomerProfile: (input: {
    displayName?: string | null;
    primaryEmail?: string | null;
    primaryPhone?: string | null;
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
  const [showHistory, setShowHistory] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [showAIDraft, setShowAIDraft] = useState(true);
  const [categoryInput, setCategoryInput] = useState(ticket.category ?? "");
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
  const [selectedAssigneeId, setSelectedAssigneeId] = useState(ticket.assigned_user_id ?? "");
  const [customerDisplayNameInput, setCustomerDisplayNameInput] = useState("");
  const [customerPrimaryEmailInput, setCustomerPrimaryEmailInput] = useState("");
  const [customerPrimaryPhoneInput, setCustomerPrimaryPhoneInput] = useState("");
  const [customerProfileError, setCustomerProfileError] = useState<string | null>(null);
  const conversationScrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setReplyText("");
    setShowAIDraft(true);
    setCategoryInput(ticket.category ?? "");
    setMetadataInput(JSON.stringify(ticket.metadata ?? {}, null, 2));
    setMetadataError(null);
    setNewTag("");
    setComposerError(null);
    setShowMacroPicker(false);
    setMacroQuery("");
    setReplyAttachments([]);
    setSelectedTemplateId("");
    setWaTemplateParams("");
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
    setCustomerProfileError(null);
  }, [
    customerProfile?.id,
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

  const customerIdentityRows = useMemo(() => {
    const rows = customerProfile?.identities ?? [];
    return rows.slice(0, 8);
  }, [customerProfile?.identities]);

  const primaryChannel = useMemo(
    () => inferPrimaryChannel(ticket, messages),
    [messages, ticket]
  );

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
      for (const message of messages) {
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
      for (const message of messages) {
        addOption(message.from.email, message.direction === "inbound" ? "Inbound contact" : "Known contact");
        addOption(message.to.email, "Known contact");
      }
    }

    return Array.from(options.values());
  }, [
    customerProfile?.identities,
    customerProfile?.primaryEmail,
    customerProfile?.primaryPhone,
    messages,
    primaryChannel,
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
    conversationScrollRef.current?.scrollTo({ top: 0 });
  }, [ticket.id]);

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
    const inboundTimes = messages
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
  }, [messages, primaryChannel]);

  const tagSuggestions = useMemo(() => {
    const normalized = newTag.trim().toLowerCase();
    return availableTags
      .filter((candidate) => !ticket.tags.includes(candidate.name))
      .filter((candidate) => !normalized || candidate.name.includes(normalized))
      .slice(0, 5);
  }, [availableTags, newTag, ticket.tags]);

  const displayReplyError = composerError ?? replyError;

  const customerProfileDirty = useMemo(() => {
    if (!customerProfile) return false;
    const nextDisplayName = customerDisplayNameInput.trim();
    const nextPrimaryEmail = customerPrimaryEmailInput.trim().toLowerCase();
    const nextPrimaryPhone = customerPrimaryPhoneInput.trim();
    const currentDisplayName = customerProfile.displayName?.trim() ?? "";
    const currentPrimaryEmail = customerProfile.primaryEmail?.trim().toLowerCase() ?? "";
    const currentPrimaryPhone = customerProfile.primaryPhone?.trim() ?? "";
    return (
      nextDisplayName !== currentDisplayName ||
      nextPrimaryEmail !== currentPrimaryEmail ||
      nextPrimaryPhone !== currentPrimaryPhone
    );
  }, [
    customerDisplayNameInput,
    customerPrimaryEmailInput,
    customerPrimaryPhoneInput,
    customerProfile
  ]);

  const submitReply = async () => {
    setComposerError(null);

    if (primaryChannel === "voice") {
      setComposerError("Voice tickets use the call workflow instead of text reply.");
      return;
    }

    if (replyRecipientOptions.length === 0) {
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
      recipient: selectedRecipient || null,
      template,
      attachments: attachmentPayload.length ? attachmentPayload : null
    });
    if (success) {
      setReplyText("");
      setReplyAttachments([]);
      setSelectedTemplateId("");
      setWaTemplateParams("");
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
    const currentDisplayName = customerProfile.displayName?.trim() ?? "";
    const currentPrimaryEmail = customerProfile.primaryEmail?.trim().toLowerCase() ?? "";
    const currentPrimaryPhone = customerProfile.primaryPhone?.trim() ?? "";

    const patch: {
      displayName?: string | null;
      primaryEmail?: string | null;
      primaryPhone?: string | null;
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
      <div className="w-full h-full flex">
        <div className="flex-1 bg-white border-r border-neutral-200 flex flex-col">
          <div className="border-b border-neutral-200 p-6">
            <div className="flex items-start justify-between mb-4">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-2">
                  <Button variant="ghost" size="sm" className="gap-2 -ml-2" onClick={() => setShowHistory(true)}>
                    <Clock className="w-4 h-4" />
                  </Button>
                  <span className="text-sm font-medium text-neutral-600">{ticket.id}</span>
                  <Badge variant="outline" className="text-xs">
                    {toTitleCase(primaryChannel)}
                  </Badge>
                </div>
                <h2 className="text-xl font-semibold mb-2">{ticket.subject}</h2>
                <p className="text-sm text-neutral-600">
                  {ticket.requester_name} • {ticket.requester_email}
                </p>
              </div>
              <Button variant="ghost" size="sm">
                <MoreHorizontal className="w-4 h-4" />
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

          <div ref={conversationScrollRef} className="flex-1 overflow-y-auto p-6">
            <div className="max-w-3xl mx-auto space-y-4">
              {detailLoading ? <p className="text-sm text-neutral-600">Loading conversation...</p> : null}
              {detailError ? <p className="text-sm text-red-600">{detailError}</p> : null}
              {!detailLoading && !detailError
                ? messages.map((message) => (
                    <ConversationMessageItem
                      key={message.id}
                      message={message}
                      onResendWhatsApp={onResendWhatsApp}
                      resending={resendingMessageId === message.id}
                    />
                  ))
                : null}
              {!detailLoading && !detailError && messages.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-xs text-neutral-500">No messages yet</p>
                </div>
              ) : null}
            </div>
          </div>

          <div className="border-t border-neutral-200 p-4">
            <div className="max-w-3xl mx-auto">
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

                  <div className="grid gap-2">
                    <label className="text-xs font-medium text-neutral-600">Recipient</label>
                    <select
                      className="h-9 rounded-md border border-neutral-200 bg-white px-3 text-sm"
                      value={selectedRecipient}
                      onChange={(event) => setSelectedRecipient(event.target.value)}
                    >
                      {replyRecipientOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label} • {option.value}
                        </option>
                      ))}
                    </select>
                    {replyRecipientOptions.length === 0 ? (
                      <p className="text-xs text-red-600">No valid recipient found for this channel.</p>
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
                    replyRecipientOptions.length === 0
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

        <div className="w-80 bg-white overflow-y-auto p-6">
          <h3 className="font-semibold mb-4">Customer Details</h3>

          <div className="mb-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 font-medium">
                {customerDisplayName.charAt(0)}
              </div>
              <div className="flex-1">
                <p className="font-medium text-sm">{customerDisplayName}</p>
                {customerDisplayEmail ? (
                  <p className="text-xs text-neutral-600 break-all">{customerDisplayEmail}</p>
                ) : null}
                {customerDisplayPhone ? (
                  <p className="text-xs text-neutral-600 break-all">{customerDisplayPhone}</p>
                ) : null}
              </div>
            </div>
            {customerProfile?.kind ? (
              <Badge variant="outline" className="h-5 text-[10px]">
                {customerProfile.kind === "registered" ? "Registered profile" : "Unregistered profile"}
              </Badge>
            ) : null}
            <div className="mt-3 space-y-3 rounded-lg border border-neutral-200 bg-neutral-50 p-3">
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
              <div className="flex justify-end">
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
              </div>
              {!customerProfile ? (
                <p className="text-xs text-neutral-500">
                  Customer profile is not linked yet.
                </p>
              ) : null}
              {customerProfileError ? <p className="text-xs text-red-600">{customerProfileError}</p> : null}
            </div>
            {customerIdentityRows.length > 0 ? (
              <div className="mt-3 space-y-1.5">
                <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-neutral-500">Known identities</p>
                {customerIdentityRows.map((identity) => (
                  <div key={`${identity.type}-${identity.value}`} className="flex items-center justify-between text-xs">
                    <span className="text-neutral-600">
                      {identity.type === "email" ? "Email" : "Phone"}
                    </span>
                    <span className="max-w-[170px] truncate text-neutral-900">{identity.value}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>

          <div className="mb-6">
            <div className="mb-2 flex items-center gap-2">
              <Tag className="h-4 w-4 text-neutral-400" />
              <h4 className="text-xs font-medium text-neutral-600">Tags</h4>
            </div>
            <div className="mb-3 flex flex-wrap gap-2">
              {ticket.tags.length > 0 ? (
                ticket.tags.map((tag) => (
                  <div
                    key={tag}
                    className="inline-flex items-center gap-1 rounded-full border border-neutral-200 bg-white px-2.5 py-1 text-xs"
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
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))
              ) : (
                <span className="text-xs text-neutral-500">No tags</span>
              )}
            </div>
            <div className="flex gap-2">
              <Input
                value={newTag}
                onChange={(event) => setNewTag(event.target.value)}
                placeholder="Add tag"
                disabled={ticketUpdating}
              />
              <Button
                size="sm"
                variant="outline"
                disabled={ticketUpdating || !newTag.trim()}
                onClick={() => {
                  void addTag(newTag);
                }}
              >
                Add
              </Button>
            </div>
            {tagSuggestions.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-2">
                {tagSuggestions.map((candidate) => (
                  <Button
                    key={candidate.id}
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
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
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-neutral-600">Category</label>
                <div className="flex gap-2">
                  <Input
                    value={categoryInput}
                    onChange={(event) => setCategoryInput(event.target.value)}
                    placeholder="General"
                    disabled={ticketUpdating}
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={ticketUpdating}
                    onClick={() => {
                      void onTicketPatch({ category: categoryInput.trim() });
                    }}
                  >
                    <Save className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              {currentUser?.role_name === "lead_admin" ? (
                <div>
                  <label className="mb-1 block text-xs font-medium text-neutral-600">Assigned user</label>
                  <div className="flex gap-2">
                    <select
                      className="h-9 flex-1 rounded-md border border-neutral-200 bg-white px-3 text-sm"
                      value={selectedAssigneeId}
                      onChange={(event) => setSelectedAssigneeId(event.target.value)}
                      disabled={ticketUpdating}
                    >
                      <option value="">Unassigned</option>
                      {assigneeOptions.map((user) => (
                        <option key={user.id} value={user.id}>
                          {user.display_name} ({user.email})
                        </option>
                      ))}
                    </select>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={ticketUpdating}
                      onClick={() => {
                        void onTicketPatch({ assignedUserId: selectedAssigneeId || null });
                      }}
                    >
                      <Save className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ) : ticket.assigned_user_name ? (
                <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-700">
                  Assigned to {ticket.assigned_user_name}
                </div>
              ) : null}
            </div>
          </div>

          <div className="mb-6">
            <h4 className="text-xs font-medium text-neutral-600 mb-2">Metadata</h4>
            <div className="space-y-2 rounded-lg border border-neutral-200 bg-neutral-50 p-3">
              {metadataEntries.length > 0 ? (
                metadataEntries.map(([key, value]) => (
                  <div key={key} className="flex justify-between text-xs gap-4">
                    <span className="text-neutral-600">{key}:</span>
                    <span className="text-neutral-900 text-right">{String(value)}</span>
                  </div>
                ))
              ) : (
                <span className="text-xs text-neutral-500">No metadata</span>
              )}
            </div>
            <div className="mt-3">
              <label className="mb-1 block text-xs font-medium text-neutral-600">Edit JSON</label>
              <Textarea
                rows={8}
                className="font-mono text-xs"
                value={metadataInput}
                onChange={(event) => setMetadataInput(event.target.value)}
                disabled={ticketUpdating}
              />
              {metadataError ? <p className="mt-2 text-xs text-red-600">{metadataError}</p> : null}
              <div className="mt-2 flex justify-end">
                <Button size="sm" variant="outline" disabled={ticketUpdating} onClick={() => void saveMetadata()}>
                  Save Metadata
                </Button>
              </div>
            </div>
          </div>

          <div>
            <h4 className="text-xs font-medium text-neutral-600 mb-2">Recent Activity</h4>
            <div className="space-y-3">
              <div className="text-xs">
                <p className="text-neutral-600 mb-1">Ticket created</p>
                <p className="text-neutral-500">{new Date(ticket.created_at).toLocaleString()}</p>
              </div>
              <div className="text-xs">
                <p className="text-neutral-600 mb-1">Last updated</p>
                <p className="text-neutral-500">{new Date(ticket.updated_at).toLocaleString()}</p>
              </div>
            </div>
          </div>

          <div className="mt-6">
            <h4 className="mb-2 text-xs font-medium text-neutral-600">Interaction History</h4>
            <div className="space-y-2">
              {interactionHistoryRows.length === 0 ? (
                <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs text-neutral-500">
                  No omnichannel ticket history yet.
                </div>
              ) : (
                interactionHistoryRows.map((historyItem) => {
                  const isCurrentTicket = historyItem.ticketId === ticket.id;
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
                        if (isCurrentTicket) {
                          conversationScrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
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
        </div>
      </div>

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
    return (
      <div className="rounded-lg border border-neutral-200 bg-white p-4">
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
      </div>
    );
  }

  if (message.channel === "whatsapp") {
    return (
      <div className={cn("flex", message.direction === "outbound" ? "justify-end" : "justify-start")}>
        <div
          className={cn(
            "max-w-[70%] rounded-lg p-3",
            message.direction === "outbound"
              ? "bg-blue-500 text-white"
              : "border border-neutral-200 bg-white"
          )}
        >
          <div className="mb-1 flex items-center gap-2">
            <span className="text-xs font-medium">{message.from.name}</span>
            <Badge
              variant="outline"
              className={cn(
                "text-xs",
                message.direction === "outbound"
                  ? "border-blue-300 text-blue-100"
                  : "border-neutral-300"
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
                    ? "border-blue-300 text-blue-100"
                    : "border-neutral-300"
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
                      ? "border-blue-300/60 bg-blue-400/20 text-blue-50 hover:bg-blue-400/30"
                      : "border-neutral-200 bg-neutral-50 text-neutral-700 hover:bg-neutral-100"
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
      <div className="rounded-lg border border-neutral-200 bg-white p-4">
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
                <Badge variant="outline" className="bg-green-50 text-xs">
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
