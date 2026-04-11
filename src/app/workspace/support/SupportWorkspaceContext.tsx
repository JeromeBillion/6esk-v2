
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
import { DESK_LIVE_EVENT_NAME, type DeskLiveEventDetail } from "@/app/lib/desk-live";
import { encodeAttachments, formatFileSize } from "@/app/lib/files";
import { isAbortError } from "@/app/lib/api/http";
import type {
  TicketStatusDisplay,
  TicketPriorityDisplay,
  TicketView,
  ConversationMessage,
  ReplyAttachment,
  ReplyRecipientOption,
  WhatsAppWindowState,
  DraftView,
  CustomerTicketHistoryItem,
  LinkedCaseHistoryItem,
  CustomerProfileView,
  FeedbackState,
  SavedViewFilters
} from "../support/types";
import {
  API_STATUS_BY_DISPLAY,
  API_PRIORITY_BY_DISPLAY,
  STATUS_FILTER_VALUES,
  PRIORITY_FILTER_VALUES,
  CHANNEL_FILTER_VALUES,
  ASSIGNED_FILTER_VALUES,
  SUPPORT_QUEUE_WIDTH_STORAGE_KEY,
  SUPPORT_DETAIL_SIDEBAR_WIDTH_STORAGE_KEY,
  SUPPORT_COMPOSER_HEIGHT_STORAGE_KEY,
  SUPPORT_QUEUE_WIDTH_DEFAULT,
  SUPPORT_DETAIL_SIDEBAR_WIDTH_DEFAULT,
  SUPPORT_COMPOSER_HEIGHT_DEFAULT,
  SUPPORT_QUEUE_WIDTH_MIN,
  SUPPORT_QUEUE_WIDTH_MAX,
  SUPPORT_DETAIL_SIDEBAR_WIDTH_MIN,
  SUPPORT_DETAIL_SIDEBAR_WIDTH_MAX,
  SUPPORT_COMPOSER_HEIGHT_MIN,
  SUPPORT_COMPOSER_HEIGHT_MAX,
  DISPLAY_STATUS_BY_API,
  DISPLAY_PRIORITY_BY_API
} from "../support/types";
import {
  clampNumber,
  toTitleCase,
  normalizeAddress,
  deriveNameFromIdentity,
  stripHtml,
  formatDateRelative,
  formatDuration,
  normalizeRecipientEmail,
  normalizeRecipientPhone,
  normalizeQueuePreviewValue,
  formatTicketDisplayId,
  readMetadataText,
  deriveCustomerAddress,
  getTemplateParamCount,
  whatsappStatusIcon,
  whatsappStatusIconColor,
  mapTicket,
  mapHistoryStatus,
  inferPrimaryChannel,
  normalizeSavedViewFilters,
  areSavedViewFiltersEqual,
  buildConversationTimeline,
  buildConversationMessages,
  mapTicketEvent,
  readStoredPaneSize,
  getPriorityColor,
  getStatusColor
} from "../support/utils";
import { TicketDetail } from "../support/SupportTicketDetail";
import { SupportQueuePane } from "../support/SupportQueuePane";
import { SupportModals } from "../support/SupportModals";

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

import { createContext, useContext, ReactNode } from "react";

export const SupportWorkspaceContext = createContext<any>(undefined);

export function SupportWorkspaceProvider({ children }: { children: ReactNode }) {

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
  const [statusFilter, setStatusFilter] = useState<"all" | TicketStatusDisplay>("all");
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

    setStatusFilter(
      STATUS_FILTER_VALUES.has(status) ? (status as "all" | TicketStatusDisplay) : "all"
    );
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

    void listTags()
      .then((rows) => {
        if (!cancelled) setAvailableTags(rows);
      })
      .catch(() => {
        if (!cancelled) setAvailableTags([]);
      });

    void loadSavedViews();

    return () => {
      cancelled = true;
    };
  }, [loadSavedViews]);

  const assigneeNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const u of assigneeOptions) {
      map.set(u.id, u.display_name || u.email);
    }
    return map;
  }, [assigneeOptions]);

  const selectedTicket = useMemo(
    () => tickets.find((t) => t.id === selectedTicketId) || null,
    [selectedTicketId, tickets]
  );
  const assignedName = selectedTicket?.assigned_user_id
    ? assigneeNameById.get(selectedTicket.assigned_user_id)
    : null;

  const loadTickets = useCallback(
    async (signal?: AbortSignal) => {
      setQueueLoading(true);
      setQueueError(null);
      try {
        const baseFilters = {
          status: statusFilter !== "all" ? statusFilter : undefined,
          priority: priorityFilter !== "all" ? priorityFilter : undefined,
          channel: channelFilter !== "all" ? channelFilter : undefined,
          tag: tagFilter !== "all" ? tagFilter : undefined,
          query: searchQuery.trim() || undefined
        };

        const [allQueueRows, mineQueueRows] = await Promise.all([
          listTickets({ ...baseFilters, signal }),
          listTickets(
            {
              ...baseFilters,
              assigned: "mine",
              signal
            }
          )
        ]);

        const nextTickets = (assignedMine ? mineQueueRows : allQueueRows).map(mapTicket);
        setTickets(nextTickets);
        setQueueCounts({
          all: allQueueRows.length,
          mine: mineQueueRows.length
        });

        if (selectedTicketId) {
          const allowed = nextTickets.some((t) => t.id === selectedTicketId);
          if (!allowed) {
            setSelectedTicketId(null);
          }
        }
      } catch (error) {
        if (isAbortError(error)) return;
        setTickets([]);
        setQueueCounts({ all: 0, mine: 0 });
        setQueueError(error instanceof Error ? error.message : "Failed to load tickets");
      } finally {
        setQueueLoading(false);
      }
    },
    [assignedMine, channelFilter, priorityFilter, searchQuery, selectedTicketId, statusFilter, tagFilter]
  );

  useEffect(() => {
    const controller = new AbortController();
    void loadTickets(controller.signal);
    return () => controller.abort();
  }, [loadTickets]);

  const loadTicketDetails = useCallback(async (ticketId: string, signal?: AbortSignal) => {
    setDetailLoading(true);
    setDetailError(null);
    try {
      const details = await getTicketDetails(ticketId, signal);
      const mappedSelectedTicketMessages = await buildConversationMessages(details, signal);
      setConversationMessages(mappedSelectedTicketMessages);
      setSelectedTicketMessages(mappedSelectedTicketMessages);
      setTicketEvents(details.events.map(mapTicketEvent));
      setAuditEvents(
        (details.auditLogs ?? []).map((entry) => ({
          id: entry.id,
          action: toTitleCase(entry.action),
          actor: entry.actor_name ?? entry.actor_email ?? "System",
          entity: toTitleCase(entry.entity_type),
          timestamp: entry.created_at
        }))
      );

      const mappedLinkedCases = (details.linkedTickets ?? []).map((item) => ({
        linkId: item.linkId,
        ticketId: item.ticketId,
        ticketDisplayId: formatTicketDisplayId(item.ticketNumber, item.ticketId),
        customerId: item.customerId,
        subject: item.subject ?? "(no subject)",
        status: DISPLAY_STATUS_BY_API[item.status],
        priority: DISPLAY_PRIORITY_BY_API[item.priority],
        channel: item.channel,
        requesterEmail: item.requesterEmail,
        linkedAt: item.linkedAt,
        reason: item.reason
      }));
      setLinkedCaseTickets(mappedLinkedCases);

      const relatedTicketIds = Array.from(
        new Set(
          mappedLinkedCases
            .map((item) => item.ticketId)
            .filter((linkedTicketId) => linkedTicketId && linkedTicketId !== ticketId)
        )
      );

      if (relatedTicketIds.length > 0) {
        const relatedTimelineGroups = await Promise.all(
          relatedTicketIds.map(async (relatedTicketId) => {
            try {
              const relatedDetails = await getTicketDetails(relatedTicketId, signal);
              return await buildConversationMessages(relatedDetails, signal);
            } catch {
              return [];
            }
          })
        );
        const mergedMessages = [...mappedSelectedTicketMessages, ...relatedTimelineGroups.flat()];
        mergedMessages.sort(
          (left, right) =>
            new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime()
        );
        setConversationMessages(mergedMessages);
      }

      const pendingDraft =
        details.drafts
          .filter((draft) => draft.status === "pending")
          .sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null;
      setActiveDraft(
        pendingDraft
          ? {
              id: pendingDraft.id,
              suggested_body:
                pendingDraft.body_text?.trim() ||
                (pendingDraft.body_html ? stripHtml(pendingDraft.body_html) : ""),
              confidence: pendingDraft.confidence
            }
          : null
      );

      try {
        const customerHistory = await getTicketCustomerHistory(ticketId, 30, signal);

        if (customerHistory.customer) {
          setCustomerProfile({
            id: customerHistory.customer.id,
            kind: customerHistory.customer.kind,
            displayName: customerHistory.customer.display_name,
            primaryEmail: customerHistory.customer.primary_email,
            primaryPhone: customerHistory.customer.primary_phone,
            address: customerHistory.customer.address ?? null,
            identities: customerHistory.customer.identities ?? []
          });
        } else {
          setCustomerProfile(null);
        }

        setCustomerTicketHistory(
          customerHistory.history.map((item) => ({
            ticketId: item.ticketId,
            ticketDisplayId: formatTicketDisplayId(item.ticketNumber, item.ticketId),
            subject: item.subject ?? "(no subject)",
            status: mapHistoryStatus(item.status),
            channel: item.channel,
            lastActivityAt:
              item.lastMessageAt ?? item.lastCustomerInboundAt ?? new Date().toISOString(),
            lastCustomerInboundAt: item.lastCustomerInboundAt
          }))
        );
      } catch {
        setCustomerProfile(null);
        setCustomerTicketHistory([]);
      }
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
    if (!selectedTicketId) {
      setConversationMessages([]);
      setSelectedTicketMessages([]);
      setTicketEvents([]);
      setAuditEvents([]);
      setCustomerProfile(null);
      setCustomerTicketHistory([]);
      setLinkedCaseTickets([]);
      setActiveDraft(null);
      setDetailError(null);
      return;
    }
    const controller = new AbortController();
    void loadTicketDetails(selectedTicketId, controller.signal);
    return () => controller.abort();
  }, [loadTicketDetails, selectedTicketId]);

  useEffect(() => {
    const handleDeskLiveEvent = (e: Event) => {
      const detail = (e as CustomEvent<DeskLiveEventDetail>).detail;
      const { type, payload } = detail as any;
      if (type === "ticket.updated" || type === "message.created" || type === "draft.created") {
        if (payload.ticket_id === selectedTicketId) {
          if (selectedTicketId) void loadTicketDetails(selectedTicketId);
        }
        void loadTickets();
      }
    };
    if (typeof window !== "undefined") {
      window.addEventListener(DESK_LIVE_EVENT_NAME, handleDeskLiveEvent);
      return () => {
        window.removeEventListener(DESK_LIVE_EVENT_NAME, handleDeskLiveEvent);
      };
    }
  }, [selectedTicketId, loadTicketDetails, loadTickets]);

  useEffect(() => {
    if (searchQuery.trim() || statusFilter !== "all" || priorityFilter !== "all" || channelFilter !== "all" || tagFilter !== "all" || !assignedMine) {
      const matching = savedViews.find(view => areSavedViewFiltersEqual(view.filters, currentFilters));
      setActiveSavedViewId(matching ? matching.id : null);
    } else {
      setActiveSavedViewId(null);
    }
  }, [currentFilters, savedViews, searchQuery, statusFilter, priorityFilter, channelFilter, tagFilter, assignedMine]);

  const activeSavedView = useMemo(
    () => savedViews.find((v) => v.id === activeSavedViewId) || null,
    [activeSavedViewId, savedViews]
  );

  const activeQueueFilters = useMemo(() => {
    const filters: Array<{ key: keyof SavedViewFilters; label: string }> = [];
    if (statusFilter !== "all") {
      filters.push({ key: "status", label: `Status: ${toTitleCase(statusFilter)}` });
    }
    if (priorityFilter !== "all") {
      filters.push({ key: "priority", label: `Priority: ${toTitleCase(priorityFilter)}` });
    }
    if (channelFilter !== "all") {
      filters.push({ key: "channel", label: `Channel: ${toTitleCase(channelFilter)}` });
    }
    if (tagFilter !== "all") {
      filters.push({ key: "tag", label: `Tag: ${tagFilter}` });
    }
    if (!assignedMine) {
      filters.push({ key: "assigned", label: "Assigned: Any" });
    }
    const normalizedQuery = searchQuery.trim();
    if (normalizedQuery) {
      filters.push({ key: "query", label: `Search: ${normalizedQuery}` });
    }
    return filters;
  }, [statusFilter, priorityFilter, channelFilter, tagFilter, assignedMine, searchQuery]);

  const clearQueueFilter = useCallback((key: keyof SavedViewFilters) => {
    switch (key) {
      case "status":
        setStatusFilter("all");
        break;
      case "priority":
        setPriorityFilter("all");
        break;
      case "channel":
        setChannelFilter("all");
        break;
      case "tag":
        setTagFilter("all");
        break;
      case "assigned":
        setAssignedMine(true);
        break;
      case "query":
        setSearchQuery("");
        break;
    }
  }, []);

  const clearAllQueueFilters = useCallback(() => {
    setStatusFilter("all");
    setPriorityFilter("all");
    setChannelFilter("all");
    setTagFilter("all");
    setAssignedMine(true);
    setSearchQuery("");
    setActiveSavedViewId(null);
  }, []);

  const applySavedView = useCallback((view: SupportSavedView) => {
    const normalized = normalizeSavedViewFilters(view.filters);
    setStatusFilter(normalized.status || "all");
    setPriorityFilter(normalized.priority || "all");
    setChannelFilter(normalized.channel || "all");
    setTagFilter(normalized.tag || "all");
    setAssignedMine(normalized.assigned !== "any");
    setSearchQuery(normalized.query || "");
    setActiveSavedViewId(view.id);
  }, []);

  const saveCurrentView = useCallback(
    async (name: string) => {
      setSavedViewSaving(true);
      try {
        const payload = {
          name,
          filters: currentFilters
        };
        await createSupportSavedView(payload);
        await loadSavedViews();
        openFeedback({
          tone: "success",
          title: "View saved",
          message: `"${name}" was added to your saved views.`,
          autoCloseMs: 2000
        });
        setSavedViewsOpen(false);
      } catch (error) {
        openFeedback({
          tone: "error",
          title: "Failed to save view",
          message: error instanceof Error ? error.message : "An unknown error occurred"
        });
      } finally {
        setSavedViewSaving(false);
      }
    },
    [currentFilters, loadSavedViews, openFeedback]
  );

  const removeSavedView = useCallback(
    async (id: string, name: string) => {
      setSavedViewDeletingId(id);
      try {
        await deleteSupportSavedView(id);
        await loadSavedViews();
        if (activeSavedViewId === id) {
          clearAllQueueFilters();
        }
        openFeedback({
          tone: "success",
          title: "View deleted",
          message: `"${name}" was removed.`,
          autoCloseMs: 2000
        });
      } catch (error) {
        openFeedback({
          tone: "error",
          title: "Failed to delete view",
          message: error instanceof Error ? error.message : "An unknown error occurred"
        });
      } finally {
        setSavedViewDeletingId(null);
      }
    },
    [activeSavedViewId, clearAllQueueFilters, loadSavedViews, openFeedback]
  );

  const toggleTicketSelection = useCallback((ticketId: string) => {
    setSelectedTickets((prev) => {
      const next = new Set(prev);
      if (next.has(ticketId)) {
        next.delete(ticketId);
      } else {
        next.add(ticketId);
      }
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    setSelectedTickets((prev) => {
      if (prev.size === tickets.length && tickets.length > 0) {
        return new Set();
      }
      return new Set(tickets.map((t) => t.id));
    });
  }, [tickets]);

  const parseBulkTags = (input: string) => {
    return input.split(",").map((s) => s.trim()).filter(Boolean);
  };

  const applyBulkActions = useCallback(async () => {
    if (selectedTickets.size === 0) return;
    setBulkUpdating(true);
    try {
      const ticketIds = Array.from(selectedTickets);
      const addTags = parseBulkTags(bulkAddTagsInput);
      const removeTags = parseBulkTags(bulkRemoveTagsInput);
      
      const payload: any = { ticketIds };
      let hasUpdates = false;

      if (bulkStatusValue) {
        payload.status = API_STATUS_BY_DISPLAY[bulkStatusValue];
        hasUpdates = true;
      }
      if (bulkPriorityValue) {
        payload.priority = API_PRIORITY_BY_DISPLAY[bulkPriorityValue];
        hasUpdates = true;
      }
      if (bulkAssigneeValue !== "__nochange") {
        payload.assignedUserId = bulkAssigneeValue === "__unassigned" ? null : bulkAssigneeValue;
        hasUpdates = true;
      }
      if (addTags.length > 0) {
        payload.addTags = addTags;
        hasUpdates = true;
      }
      if (removeTags.length > 0) {
        payload.removeTags = removeTags;
        hasUpdates = true;
      }

      if (hasUpdates) {
        await patchTicketsBulk(payload);
        await loadTickets();
        
        if (selectedTicketId && selectedTickets.has(selectedTicketId)) {
          await loadTicketDetails(selectedTicketId);
        }
        
        setSelectedTickets(new Set());
        setBulkActionsOpen(false);
        setBulkAddTagsInput("");
        setBulkRemoveTagsInput("");
        
        openFeedback({
          tone: "success",
          title: "Bulk update complete",
          message: `${ticketIds.length} tickets were updated successfully.`,
          autoCloseMs: 2500
        });
      }
    } catch (error) {
      openFeedback({
        tone: "error",
        title: "Bulk update failed",
        message: error instanceof Error ? error.message : "Failed to apply changes"
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
    loadTicketDetails,
    loadTickets,
    openFeedback,
    selectedTicketId,
    selectedTickets
  ]);

  const resetBulkEmailComposer = useCallback(() => {
    setBulkEmailSubject("");
    setBulkEmailBody("");
    setBulkEmailAttachments([]);
  }, []);

  const handleBulkEmailAttachmentChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    try {
      const prepared = await encodeAttachments(Array.from(files));
      setBulkEmailAttachments((prev) => [...prev, ...prepared]);
    } catch (error) {
      openFeedback({
        tone: "error",
        title: "Attachment failed",
        message: error instanceof Error ? error.message : "Failed to attach file(s)"
      });
    }
    e.target.value = "";
  };

  const submitBulkEmail = useCallback(async () => {
    if (selectedTickets.size === 0) return;
    if (!bulkEmailSubject.trim() || !bulkEmailBody.trim()) {
      openFeedback({
        tone: "error",
        title: "Missing fields",
        message: "Subject and message body are required."
      });
      return;
    }
    
    setBulkEmailSending(true);
    try {
      const ticketIds = Array.from(selectedTickets);
      const payload = {
        ticketIds,
        subject: bulkEmailSubject.trim(),
        text: bulkEmailBody.trim(),
        htmlBody: bulkEmailBody.trim().replace(/\n/g, "<br>"),
        attachments: bulkEmailAttachments
      };
      
      const response = await createBulkEmailTickets(payload);
      
      openFeedback({
        tone: "success",
        title: "Bulk emails queued",
        message: `${response.createdCount} tickets processed (${response.failedCount} failed).`,
        autoCloseMs: 3000
      });
      
      setBulkEmailOpen(false);
      resetBulkEmailComposer();
      setSelectedTickets(new Set());
      await loadTickets();
      
    } catch (error) {
      openFeedback({
        tone: "error",
        title: "Bulk email failed",
        message: error instanceof Error ? error.message : "Failed to send bulk emails"
      });
    } finally {
      setBulkEmailSending(false);
    }
  }, [
    bulkEmailAttachments,
    bulkEmailBody,
    bulkEmailSubject,
    loadTickets,
    openFeedback,
    resetBulkEmailComposer,
    selectedTickets
  ]);

  const updateTicket = useCallback(
    async (patch: any) => {
      if (!selectedTicketId) return false;
      setTicketUpdating(true);
      try {
        await patchTicket(selectedTicketId, patch);
        await loadTickets();
        await loadTicketDetails(selectedTicketId);
        return true;
      } catch (error) {
        openFeedback({
          tone: "error",
          title: "Update failed",
          message: error instanceof Error ? error.message : "Failed to update ticket"
        });
        return false;
      } finally {
        setTicketUpdating(false);
      }
    },
    [loadTicketDetails, loadTickets, openFeedback, selectedTicketId]
  );
  
  const openVoiceCallModal = useCallback(async () => {
    if (!selectedTicketId) return;
    setVoiceModalOpen(true);
    setCallOptionsLoading(true);
    setCallError(null);
    setCallSuccessMessage(null);
    
    try {
      const options = await getTicketCallOptions(selectedTicketId);
      setCallOptions(options);
      
      if (options.candidates.length === 1) {
        setSelectedCallCandidateId(options.candidates[0].candidateId);
      } else if (options.defaultCandidateId) {
        setSelectedCallCandidateId(options.defaultCandidateId);
      } else if (options.candidates.length > 0) {
        setSelectedCallCandidateId(options.candidates[0].candidateId);
      }
      
    } catch (error) {
      setCallError(error instanceof Error ? error.message : "Failed to load call options");
    } finally {
      setCallOptionsLoading(false);
    }
  }, [selectedTicketId]);

  const submitVoiceCall = useCallback(async () => {
    if (!selectedTicketId) return;
    
    setCallQueueing(true);
    setCallError(null);
    
    try {
      const payload: any = { ticketId: selectedTicketId };
      if (selectedCallCandidateId === "manual") {
        if (!manualCallPhone.trim()) {
           throw new Error("Manual phone number is required");
        }
        payload.manualPhone = manualCallPhone.trim();
      } else {
        payload.phoneCandidateId = selectedCallCandidateId;
      }
      if (callReason.trim()) {
        payload.internalReason = callReason.trim();
      }
      
      await queueOutboundCall(payload);
      
      setCallSuccessMessage("Call queued! The voice agent is dialing the customer now.");
      setTimeout(() => {
        setVoiceModalOpen(false);
        if (selectedTicketId) void loadTicketDetails(selectedTicketId);
      }, 2500);
      
    } catch (error) {
      setCallError(error instanceof Error ? error.message : "Failed to dispatch call");
    } finally {
      setCallQueueing(false);
    }
  }, [callReason, loadTicketDetails, manualCallPhone, selectedCallCandidateId, selectedTicketId]);

  const resendFailedWhatsApp = useCallback(
    async (messageId: string) => {
      if (!selectedTicketId) return;
      try {
        await resendWhatsAppMessage(messageId);
        await loadTicketDetails(selectedTicketId);
        openFeedback({
          tone: "success",
          title: "Message resent",
          message: "The WhatsApp message was queued for delivery.",
          autoCloseMs: 2000
        });
      } catch (error) {
        openFeedback({
          tone: "error",
          title: "Resend failed",
          message: error instanceof Error ? error.message : "Failed to resend message"
        });
      }
    },
    [loadTicketDetails, openFeedback, selectedTicketId]
  );

  const handleHistoryTicketSelect = useCallback(
    (ticketId: string) => {
      setSelectedTicketId(ticketId);
      if (window.innerWidth < 1024) {
      }
    },
    []
  );


  const supportContextValue = {
    router,
    searchParams,
    paramsKey,
    workspaceLayoutRef,
    currentUser,
    setCurrentUser,
    assigneeOptions,
    setAssigneeOptions,
    supportMacros,
    setSupportMacros,
    whatsAppTemplates,
    setWhatsAppTemplates,
    tickets,
    setTickets,
    queueCounts,
    setQueueCounts,
    selectedTicketId,
    setSelectedTicketId,
    selectedTickets,
    setSelectedTickets,
    statusFilter,
    setStatusFilter,
    priorityFilter,
    setPriorityFilter,
    channelFilter,
    setChannelFilter,
    tagFilter,
    setTagFilter,
    assignedMine,
    setAssignedMine,
    searchQuery,
    setSearchQuery,
    availableTags,
    setAvailableTags,
    queueLoading,
    setQueueLoading,
    queueError,
    setQueueError,
    showMergeModal,
    setShowMergeModal,
    mergeType,
    setMergeType,
    savedViewsOpen,
    setSavedViewsOpen,
    savedViewsLoading,
    setSavedViewsLoading,
    savedViews,
    setSavedViews,
    newSavedViewName,
    setNewSavedViewName,
    savedViewSaving,
    setSavedViewSaving,
    savedViewDeletingId,
    setSavedViewDeletingId,
    activeSavedViewId,
    setActiveSavedViewId,
    bulkActionsOpen,
    setBulkActionsOpen,
    bulkUpdating,
    setBulkUpdating,
    bulkStatusValue,
    setBulkStatusValue,
    bulkPriorityValue,
    setBulkPriorityValue,
    bulkAssigneeValue,
    setBulkAssigneeValue,
    bulkAddTagsInput,
    setBulkAddTagsInput,
    bulkRemoveTagsInput,
    setBulkRemoveTagsInput,
    bulkEmailOpen,
    setBulkEmailOpen,
    bulkEmailSending,
    setBulkEmailSending,
    bulkEmailSubject,
    setBulkEmailSubject,
    bulkEmailBody,
    setBulkEmailBody,
    bulkEmailAttachments,
    setBulkEmailAttachments,
    conversationMessages,
    setConversationMessages,
    selectedTicketMessages,
    setSelectedTicketMessages,
    ticketEvents,
    setTicketEvents,
    auditEvents,
    setAuditEvents,
    customerProfile,
    setCustomerProfile,
    customerTicketHistory,
    setCustomerTicketHistory,
    linkedCaseTickets,
    setLinkedCaseTickets,
    activeDraft,
    setActiveDraft,
    detailLoading,
    setDetailLoading,
    detailError,
    setDetailError,
    replySending,
    setReplySending,
    resendingMessageId,
    setResendingMessageId,
    replyError,
    setReplyError,
    ticketUpdating,
    setTicketUpdating,
    customerProfileUpdating,
    setCustomerProfileUpdating,
    draftUpdating,
    setDraftUpdating,
    voiceModalOpen,
    setVoiceModalOpen,
    callOptions,
    setCallOptions,
    callOptionsLoading,
    setCallOptionsLoading,
    callQueueing,
    setCallQueueing,
    callError,
    setCallError,
    callSuccessMessage,
    setCallSuccessMessage,
    selectedCallCandidateId,
    setSelectedCallCandidateId,
    manualCallPhone,
    setManualCallPhone,
    callReason,
    setCallReason,
    queuePaneWidth,
    setQueuePaneWidth,
    feedback,
    setFeedback,
    startQueueResize,
    openFeedback,
    currentFilters,
    loadSavedViews,
    assigneeNameById,
    selectedTicket,
    assignedName,
    loadTickets,
    loadTicketDetails,
    activeSavedView,
    activeQueueFilters,
    clearQueueFilter,
    clearAllQueueFilters,
    applySavedView,
    saveCurrentView,
    removeSavedView,
    toggleTicketSelection,
    toggleSelectAll,
    applyBulkActions,
    resetBulkEmailComposer,
    handleBulkEmailAttachmentChange,
    submitBulkEmail,
    updateTicket,
    openVoiceCallModal,
    submitVoiceCall,
    resendFailedWhatsApp,
    handleHistoryTicketSelect,
    demoModeEnabled
  };

  return (
    <SupportWorkspaceContext.Provider value={supportContextValue}>
      {children}
    </SupportWorkspaceContext.Provider>
  );
}

export function useSupportWorkspace() {
  const context = useContext(SupportWorkspaceContext);
  if (!context) throw new Error("Missing SupportWorkspaceProvider");
  return context;
}
