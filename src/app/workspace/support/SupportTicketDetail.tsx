import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type PointerEvent as ReactPointerEvent
} from "react";
import {
  Search,
  Filter,
  Plus,
  Mail,
  MessageSquare,
  ChevronDown,
  Clock,
  Mic,
  MicOff,
  Pause,
  Phone,
  PhoneCall,
  PhoneIncoming,
  PhoneOff,
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
import { MacroPickerModal } from "../components/MacroPickerModal";
import { HistoryModal } from "../components/HistoryModal";
import type { HistoryAuditEvent, HistoryTicketEvent } from "../components/HistoryModal";
import type { SupportMacro } from "@/app/lib/api/support";
import type { ActiveWhatsAppTemplate } from "@/app/lib/api/whatsapp";
import type { CurrentSessionUser } from "@/app/lib/api/session";
import type { AdminUserRecord, TagRecord } from "@/app/lib/api/admin";
import { formatFileSize, encodeAttachments } from "@/app/lib/files";
import { useDeskVoiceSession } from "@/app/components/DeskVoiceSessionContext";
import {
  getEnabledCustomerReplyChannels,
  type CustomerReplyChannel
} from "@/app/lib/workspace-modules-context";

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
} from "./types";
import {
  SUPPORT_DETAIL_SIDEBAR_WIDTH_STORAGE_KEY,
  SUPPORT_COMPOSER_HEIGHT_STORAGE_KEY,
  SUPPORT_DETAIL_SIDEBAR_WIDTH_DEFAULT,
  SUPPORT_COMPOSER_HEIGHT_DEFAULT,
  SUPPORT_DETAIL_SIDEBAR_WIDTH_MIN,
  SUPPORT_DETAIL_SIDEBAR_WIDTH_MAX,
  SUPPORT_COMPOSER_HEIGHT_MIN,
  SUPPORT_COMPOSER_HEIGHT_MAX,
  API_STATUS_BY_DISPLAY,
  API_PRIORITY_BY_DISPLAY
} from "./types";
import {
  clampNumber,
  toTitleCase,
  formatDateRelative,
  formatDuration,
  formatTicketDisplayId,
  normalizeRecipientEmail,
  normalizeRecipientPhone,
  normalizeAddress,
  deriveCustomerAddress,
  getTemplateParamCount,
  parseEmailAddressInput,
  buildConversationTimeline,
  inferPrimaryChannel,
  whatsappStatusIcon,
  whatsappStatusIconColor,
  getPriorityColor,
  getStatusColor
} from "./utils";

// Local hook and component implementations needed specifically by TicketDetail and its subcomponents
// We will allow these to remain inside the file for this extraction, 
// though ideally they could be extracted into a `components` sub-module eventually.

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

import { useSupportWorkspace } from "./SupportWorkspaceContext";
import {
  patchCustomerProfile,
  patchTicketTags,
  postTicketInternalComment,
  sendTicketReply,
  patchTicketDraft,
  resendWhatsAppMessage
} from "@/app/lib/api/support";

type ComposerMode = "email" | "whatsapp" | "voice" | "internal";
const PHONE_KEYPAD_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"] as const;

function voiceCandidateLabel(source: string | null | undefined) {
  switch (source) {
    case "customer_primary":
      return "Primary customer number";
    case "customer_identity":
      return "Known customer identity";
    case "ticket_requester":
      return "Ticket requester";
    case "ticket_metadata":
      return "Ticket metadata";
    default:
      return "Saved number";
  }
}

export function TicketDetail() {
  const context = useSupportWorkspace();
  const {
    selectedTicket: ticket,
    conversationMessages: messages,
    selectedTicketMessages,
    ticketEvents: events,
    auditEvents,
    customerProfile,
    customerTicketHistory,
    linkedCaseTickets,
    activeDraft: draft,
    detailLoading,
    detailError,
    replySending,
    resendingMessageId,
    replyError,
    ticketUpdating,
    customerProfileUpdating,
    draftUpdating,
    availableTags,
    supportMacros: macros,
    whatsAppTemplates,
    assigneeOptions,
    currentUser,
    moduleVisibility,
    workspaceModulesLoading,
    
    // Actions extracted from Workspace
    updateTicket,
    selectedTicketId,
    setCustomerProfileUpdating,
    loadTicketDetails,
    openFeedback,
    setTicketUpdating,
    setReplyError,
    loadTickets,
    setReplySending,
    setDraftUpdating,
    loadVoiceCallOptions,
    callOptions,
    callOptionsLoading,
    callQueueing,
    callError,
    callSuccessMessage,
    selectedCallCandidateId,
    setSelectedCallCandidateId,
    manualCallPhone,
    setManualCallPhone,
    callReason,
    setCallReason,
    submitVoiceCall,
    handleHistoryTicketSelect
  } = context;
  const deskVoice = useDeskVoiceSession();

  const onStatusChange = (status: TicketStatusDisplay) => void updateTicket({ status: API_STATUS_BY_DISPLAY[status] });
  const onPriorityChange = (priority: TicketPriorityDisplay) => void updateTicket({ priority: API_PRIORITY_BY_DISPLAY[priority] });
  const onTicketPatch = async (patch: any) => { return updateTicket(patch); };
  
  const onSaveCustomerProfile = async (input: any) => {
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
      const message = error instanceof Error ? error.message : "Failed to update customer profile";
      openFeedback({ tone: "error", title: "Customer update failed", message });
      return false;
    } finally {
      setCustomerProfileUpdating(false);
    }
  };

  const onAddTag = async (tag: string) => {
    if (!selectedTicketId) return;
    setTicketUpdating(true);
    setReplyError(null);
    try {
      await patchTicketTags(selectedTicketId, { addTags: [tag] });
      await loadTickets();
      await loadTicketDetails(selectedTicketId);
      openFeedback({ tone: "success", title: "Tag added", message: `${tag} was added to this ticket.`, autoCloseMs: 1500 });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to add tag";
      setReplyError(message);
      openFeedback({ tone: "error", title: "Tag update failed", message });
    } finally {
      setTicketUpdating(false);
    }
  };

  const onRemoveTag = async (tag: string) => {
    if (!selectedTicketId) return;
    setTicketUpdating(true);
    setReplyError(null);
    try {
      await patchTicketTags(selectedTicketId, { removeTags: [tag] });
      await loadTickets();
      await loadTicketDetails(selectedTicketId);
      openFeedback({ tone: "success", title: "Tag removed", message: `${tag} was removed from this ticket.`, autoCloseMs: 1500 });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to remove tag";
      setReplyError(message);
      openFeedback({ tone: "error", title: "Tag update failed", message });
    } finally {
      setTicketUpdating(false);
    }
  };

  const onSendReply = async (input: any) => {
    if (!selectedTicketId) return false;
    setReplySending(true);
    setReplyError(null);
    try {
      await sendTicketReply(selectedTicketId, input);
      await loadTicketDetails(selectedTicketId);
      await loadTickets();
      openFeedback({ tone: "success", title: "Reply sent", message: "Your response was added to the conversation thread.", autoCloseMs: 1500 });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to send reply";
      setReplyError(message);
      openFeedback({ tone: "error", title: "Reply failed", message });
      return false;
    } finally {
      setReplySending(false);
    }
  };

  const onSaveInternalComment = async (body: string) => {
    if (!selectedTicketId) return false;
    setInternalCommentSaving(true);
    setReplyError(null);
    try {
      await postTicketInternalComment(selectedTicketId, {
        body,
        metadata: {
          source: "support_composer"
        }
      });
      await loadTicketDetails(selectedTicketId);
      await loadTickets();
      openFeedback({
        tone: "success",
        title: "Internal comment saved",
        message: "The comment is visible to support agents and AI context only.",
        autoCloseMs: 1500
      });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to save internal comment";
      setReplyError(message);
      openFeedback({ tone: "error", title: "Internal comment failed", message });
      return false;
    } finally {
      setInternalCommentSaving(false);
    }
  };

  const onUseDraft = async (draftId: string) => {
    if (!selectedTicketId) return;
    setDraftUpdating(true);
    try {
      await patchTicketDraft(selectedTicketId, draftId, "used");
      await loadTicketDetails(selectedTicketId);
      openFeedback({ tone: "success", title: "Draft applied", message: "The AI draft has been marked as used.", autoCloseMs: 1500 });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to update draft";
      setReplyError(message);
      openFeedback({ tone: "error", title: "Draft update failed", message });
    } finally {
      setDraftUpdating(false);
    }
  };

  const onDismissDraft = async (draftId: string) => {
    if (!selectedTicketId) return;
    setDraftUpdating(true);
    try {
      await patchTicketDraft(selectedTicketId, draftId, "dismissed");
      await loadTicketDetails(selectedTicketId);
      openFeedback({ tone: "success", title: "Draft dismissed", message: "The draft was removed from this ticket workflow.", autoCloseMs: 1500 });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to dismiss draft";
      setReplyError(message);
      openFeedback({ tone: "error", title: "Dismiss failed", message });
    } finally {
      setDraftUpdating(false);
    }
  };

  const onLoadVoiceCallOptions = () => void loadVoiceCallOptions();
  const onResendWhatsApp = async (messageId: string) => { await resendWhatsAppMessage(messageId); };
  const onSelectHistoryTicket = (ticketId: string) => void handleHistoryTicketSelect(ticketId);



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
  const [composerMode, setComposerMode] = useState<ComposerMode>("email");
  const [internalCommentText, setInternalCommentText] = useState("");
  const [internalCommentSaving, setInternalCommentSaving] = useState(false);
  const [recipientOverrideOpen, setRecipientOverrideOpen] = useState(false);
  const [recipientOverrideInput, setRecipientOverrideInput] = useState("");
  const [ccInput, setCcInput] = useState("");
  const [bccInput, setBccInput] = useState("");
  const [replyComposerCollapsed, setReplyComposerCollapsed] = useState(true);
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
    setComposerMode("email");
    setInternalCommentText("");
    setInternalCommentSaving(false);
    setCcInput("");
    setBccInput("");
    setReplyComposerCollapsed(true);
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
  const enabledCustomerReplyChannels = useMemo(
    () => getEnabledCustomerReplyChannels(moduleVisibility),
    [moduleVisibility]
  );
  const preferredComposerMode = useMemo<ComposerMode>(() => {
    if (enabledCustomerReplyChannels.includes(primaryChannel as CustomerReplyChannel)) {
      return primaryChannel as ComposerMode;
    }
    return enabledCustomerReplyChannels[0] ?? "internal";
  }, [enabledCustomerReplyChannels, primaryChannel]);
  const replyChannel = composerMode === "internal" ? primaryChannel : composerMode;
  const noCustomerReplyChannels =
    !workspaceModulesLoading && enabledCustomerReplyChannels.length === 0;

  useEffect(() => {
    setComposerMode(preferredComposerMode);
  }, [preferredComposerMode, ticket.id]);

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
        ticketDisplayId: formatTicketDisplayId(ticket.ticket_number, ticket.id),
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
  }, [
    customerTicketHistory,
    primaryChannel,
    ticket.id,
    ticket.status,
    ticket.subject,
    ticket.ticket_number,
    ticket.updated_at
  ]);

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
        replyChannel === "whatsapp"
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

    if (replyChannel === "whatsapp") {
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
    } else if (replyChannel === "email") {
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
    replyChannel,
    selectedTicketMessages,
    ticket.requester_email
  ]);

  useEffect(() => {
    if (replyChannel === "voice" || composerMode === "internal") {
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
  }, [composerMode, replyChannel, replyRecipientOptions, ticket.id]);

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
    () => whatsAppTemplates.find((template: any) => template.id === selectedTemplateId) ?? null,
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
    if (replyChannel !== "whatsapp") return null;
    const inboundTimes = selectedTicketMessages
      .filter(
        (message: ConversationMessage) =>
          message.channel === "whatsapp" && message.direction === "inbound"
      )
      .map((message: ConversationMessage) => Date.parse(message.timestamp))
      .filter((value: number) => !Number.isNaN(value));
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
  }, [replyChannel, selectedTicketMessages]);

  const tagSuggestions = useMemo(() => {
    const normalized = newTag.trim().toLowerCase();
    return availableTags
      .filter((candidate: TagRecord) => !ticket.tags.includes(candidate.name))
      .filter((candidate: TagRecord) => !normalized || candidate.name.includes(normalized))
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
  const deskVoiceCall = deskVoice.activeCall ?? deskVoice.incomingCall;
  const deskVoiceCallMatchesTicket = Boolean(deskVoiceCall?.ticketId && deskVoiceCall.ticketId === ticket.id);
  const deskVoicePartyLabel =
    deskVoiceCall?.direction === "outbound"
      ? deskVoiceCall.toPhone ?? deskVoiceCall.fromPhone ?? "Unknown number"
      : deskVoiceCall?.fromPhone ?? deskVoiceCall?.toPhone ?? "Unknown number";
  const deskVoiceStatusLabel = deskVoice.activeCall
    ? "In call"
    : deskVoice.incomingCall
      ? "Incoming call"
      : !deskVoice.enabledForUser
        ? "Live voice unavailable"
        : !deskVoice.voiceEnabled
          ? "Voice disabled"
          : deskVoice.sdkStatus === "ready"
            ? "Ready"
            : deskVoice.sdkStatus === "registering"
              ? "Connecting"
              : deskVoice.sdkStatus === "error"
                ? "Voice error"
                : `${toTitleCase(deskVoice.presence)} presence`;
  const selectedVoiceCandidate = callOptions?.candidates?.find(
    (candidate: any) => candidate.candidateId === selectedCallCandidateId
  );
  const callConsentRevoked = (callOptions?.consent?.status ?? "").toLowerCase() === "revoked";
  const canQueueInlineCall =
    Boolean((selectedCallCandidateId && selectedCallCandidateId !== "manual") || manualCallPhone.trim()) &&
    callReason.trim().length > 0 &&
    !callConsentRevoked &&
    !deskVoice.activeCall &&
    !deskVoice.incomingCall;

  const composerPanelId = `support-reply-composer-${ticket.id}`;

  const handleReplyButtonClick = useCallback(() => {
    if (replyComposerCollapsed) {
      setReplyComposerCollapsed(false);
      return;
    }

    if (!recipientOverrideOpen && replyChannel !== "voice" && composerMode !== "internal") {
      setRecipientOverrideOpen(true);
      return;
    }

    setReplyComposerCollapsed(true);
    setRecipientOverrideOpen(false);
  }, [composerMode, recipientOverrideOpen, replyChannel, replyComposerCollapsed]);

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

    if (composerMode === "internal") {
      setComposerError("Use Save internal comment for internal notes.");
      return;
    }

    if (replyChannel === "voice") {
      setComposerError("Voice tickets use the call workflow instead of text reply.");
      return;
    }

    if (!moduleVisibility[replyChannel]) {
      setComposerError(`${toTitleCase(replyChannel)} is not available for this workspace package.`);
      return;
    }

    const manualRecipientRaw = recipientOverrideInput.trim();
    const manualRecipient = manualRecipientRaw
      ? replyChannel === "whatsapp"
        ? normalizeRecipientPhone(manualRecipientRaw)
        : normalizeRecipientEmail(manualRecipientRaw)
      : null;

    if (manualRecipientRaw && !manualRecipient) {
      setComposerError(
        replyChannel === "whatsapp"
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
    const ccParse = replyChannel === "whatsapp" ? { addresses: [], invalid: [] } : parseEmailAddressInput(ccInput);
    const bccParse = replyChannel === "whatsapp" ? { addresses: [], invalid: [] } : parseEmailAddressInput(bccInput);
    if (ccParse.invalid.length > 0) {
      setComposerError(
        `Enter valid Cc email address${ccParse.invalid.length === 1 ? "" : "es"}: ${ccParse.invalid.join(", ")}`
      );
      return;
    }
    if (bccParse.invalid.length > 0) {
      setComposerError(
        `Enter valid Bcc email address${bccParse.invalid.length === 1 ? "" : "es"}: ${bccParse.invalid.join(", ")}`
      );
      return;
    }
    const ccRecipients = ccParse.addresses;
    const bccRecipients = bccParse.addresses;

    let template: {
      name: string;
      language: string;
      components?: Array<Record<string, unknown>>;
    } | null = null;

    if (replyChannel === "whatsapp" && selectedTemplate) {
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

    if (replyChannel === "whatsapp" && whatsappWindow && !whatsappWindow.isOpen && !template) {
      setComposerError("WhatsApp 24h window is closed. Select a template.");
      return;
    }

    if (replyChannel === "whatsapp" && attachmentPayload.length > 1) {
      setComposerError("WhatsApp supports one attachment per message.");
      return;
    }

    if (replyChannel === "whatsapp" && attachmentPayload.length > 0 && template) {
      setComposerError("Templates cannot be combined with attachments.");
      return;
    }

    const text = replyText.trim();
    if (!text && !template && attachmentPayload.length === 0) {
      setComposerError(
        replyChannel === "whatsapp"
          ? "Add a reply or provide a template."
          : "Reply body required."
      );
      return;
    }

    const success = await onSendReply({
      text: text || null,
      recipient: resolvedRecipient || null,
      cc: ccRecipients.length ? ccRecipients : null,
      bcc: bccRecipients.length ? bccRecipients : null,
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
      setCcInput("");
      setBccInput("");
      setComposerError(null);
    }
  };

  const submitInternalComment = async () => {
    setComposerError(null);
    const body = internalCommentText.trim();
    if (!body) {
      setComposerError("Internal comment body required.");
      return;
    }

    const success = await onSaveInternalComment(body);
    if (success) {
      setInternalCommentText("");
      setComposerError(null);
      setReplyComposerCollapsed(true);
      setRecipientOverrideOpen(false);
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

    if (replyChannel === "whatsapp" && replyAttachments.length >= 1) {
      setComposerError("WhatsApp supports one attachment per message.");
      event.target.value = "";
      return;
    }

    const limit = replyChannel === "whatsapp" ? 1 : files.length;
    const nextFiles = files.slice(0, limit);

    try {
      const prepared = await encodeAttachments(nextFiles);

      setReplyAttachments((previous) =>
        replyChannel === "whatsapp" ? prepared.slice(0, 1) : [...previous, ...prepared]
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
          <div className="border-b border-neutral-200 p-5">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <div className="mb-2 flex items-center gap-2">
                  <span className="text-sm font-medium text-neutral-600">{activeTimelineTicketIdValue}</span>
                  <Badge variant="outline" className="text-xs">
                    {toTitleCase(activeTimelineChannelValue)}
                  </Badge>
                </div>
                <h2 className="mb-2 text-xl font-semibold">{ticket.subject}</h2>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <p className="text-sm text-neutral-600">
                    {ticket.requester_name} • {ticket.requester_email}
                  </p>
                  <div className="flex items-center gap-2 flex-wrap">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="outline" size="sm" className="h-8 gap-2 px-3" disabled={ticketUpdating}>
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
                        <Button variant="outline" size="sm" className="h-8 gap-2 px-3" disabled={ticketUpdating}>
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

            {!replyComposerCollapsed ? (
              <ResizeHandle orientation="horizontal" onPointerDown={startComposerResize} />
            ) : null}

            <div
              className="shrink-0 border-t border-neutral-200 bg-white"
              style={replyComposerCollapsed ? undefined : { height: composerHeight }}
            >
              <div className={cn(replyComposerCollapsed ? "p-3" : "h-full overflow-y-auto p-4")}>
                <div className="mx-auto w-full max-w-[1120px]">
                  <div
                    className={cn(
                      "flex flex-wrap items-center justify-between gap-3",
                      !replyComposerCollapsed && "mb-3"
                    )}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        aria-controls={composerPanelId}
                        aria-expanded={!replyComposerCollapsed && recipientOverrideOpen}
                        onClick={handleReplyButtonClick}
                      >
                        {replyComposerCollapsed
                          ? "Reply"
                          : composerMode === "internal" || replyChannel === "voice"
                            ? "Close"
                            : recipientOverrideOpen
                              ? "Close"
                              : "Recipients"}
                      </Button>
                      {!replyComposerCollapsed && moduleVisibility.email ? (
                        <Button
                          variant={composerMode === "email" ? "default" : "outline"}
                          size="sm"
                          className="gap-2"
                          onClick={() => {
                            setComposerMode("email");
                            setRecipientOverrideOpen(false);
                            setComposerError(null);
                          }}
                        >
                          <Mail className="h-3.5 w-3.5" />
                          Email
                        </Button>
                      ) : null}
                      {!replyComposerCollapsed && moduleVisibility.whatsapp ? (
                        <Button
                          variant={composerMode === "whatsapp" ? "default" : "outline"}
                          size="sm"
                          className="gap-2"
                          title={ticket.has_whatsapp ? "WhatsApp available" : "No saved WhatsApp number"}
                          onClick={() => {
                            setComposerMode("whatsapp");
                            setRecipientOverrideOpen(false);
                            setComposerError(null);
                          }}
                        >
                          <MessageSquare className="h-3.5 w-3.5" />
                          WhatsApp
                        </Button>
                      ) : null}
                      {!replyComposerCollapsed && moduleVisibility.voice ? (
                        <Button
                          variant={composerMode === "voice" ? "default" : "outline"}
                          size="sm"
                          className="gap-2"
                          title={ticket.has_voice ? "Call available" : "No saved phone number"}
                          onClick={() => {
                            setComposerMode("voice");
                            setRecipientOverrideOpen(false);
                            setComposerError(null);
                            void loadVoiceCallOptions();
                          }}
                        >
                          <Phone className="h-3.5 w-3.5" />
                          Call
                        </Button>
                      ) : null}
                      {!replyComposerCollapsed ? (
                        <Button
                          variant={composerMode === "internal" ? "default" : "outline"}
                          size="sm"
                          className="gap-2"
                          onClick={() => {
                            setComposerMode("internal");
                            setRecipientOverrideOpen(false);
                            setComposerError(null);
                          }}
                        >
                          <Save className="h-3.5 w-3.5" />
                          Internal
                        </Button>
                      ) : null}
                    </div>
                  </div>

                  <div id={composerPanelId}>
                    {!replyComposerCollapsed ? (
                      <>
              {workspaceModulesLoading ? (
                <div className="mb-3 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs text-neutral-600">
                  Loading workspace package...
                </div>
              ) : null}

              {noCustomerReplyChannels ? (
                <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  No customer reply channels are active for this workspace package. Internal notes remain available.
                </div>
              ) : null}

              {moduleVisibility.aiAutomation && draft && showAIDraft ? (
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
                            setReplyComposerCollapsed(false);
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

              {composerMode !== "internal" && replyChannel !== "voice" && recipientOverrideOpen ? (
                <div className="mb-3 space-y-3 rounded-lg border border-neutral-200 bg-neutral-50 p-3">
                  {replyChannel === "whatsapp" && whatsappWindow ? (
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-medium text-neutral-700">WhatsApp 24h window</p>
                      <Badge variant="outline" className="text-[11px]">
                        {whatsappWindow.isOpen
                          ? `Open • ${whatsappWindow.minutesRemaining}m left`
                          : "Closed • template required"}
                      </Badge>
                    </div>
                  ) : null}

                  <div className="rounded-lg border border-neutral-200 bg-white p-3">
                    <div className="mb-3">
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-neutral-700">Recipient override</p>
                        <p className="truncate text-[11px] text-neutral-500">
                          {defaultRecipientOption
                            ? `Default: ${defaultRecipientOption.value}`
                            : "No default recipient available"}
                        </p>
                      </div>
                    </div>

                    <div className="grid gap-2">
                      <Input
                        className="h-8 text-xs"
                        value={recipientOverrideInput}
                        onChange={(event) => {
                          setRecipientOverrideInput(event.target.value);
                          setComposerError(null);
                        }}
                        placeholder={
                          replyChannel === "whatsapp"
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

                    {replyChannel !== "whatsapp" ? (
                      <div className="mt-3 grid gap-3 md:grid-cols-2">
                        <div className="grid gap-1.5">
                          <label className="text-xs font-medium text-neutral-600">Cc</label>
                          <Input
                            className="h-8 text-xs"
                            value={ccInput}
                            onChange={(event) => {
                              setCcInput(event.target.value);
                              setComposerError(null);
                            }}
                            placeholder="cc@example.com"
                          />
                        </div>
                        <div className="grid gap-1.5">
                          <label className="text-xs font-medium text-neutral-600">Bcc</label>
                          <Input
                            className="h-8 text-xs"
                            value={bccInput}
                            onChange={(event) => {
                              setBccInput(event.target.value);
                              setComposerError(null);
                            }}
                            placeholder="bcc@example.com"
                          />
                        </div>
                      </div>
                    ) : null}
                  </div>

                  {replyChannel === "whatsapp" ? (
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
                        {whatsAppTemplates.map((template: ActiveWhatsAppTemplate) => (
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

              {composerMode === "internal" ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium text-amber-950">Internal comment</p>
                      <p className="text-xs text-amber-800">
                        Stored for support agents and AI context only. Never sent to the customer.
                      </p>
                    </div>
                    <Badge variant="outline" className="border-amber-300 bg-white text-[11px] text-amber-800">
                      Internal only
                    </Badge>
                  </div>
                  <Textarea
                    placeholder="Add internal context, handover notes, expectations, or investigation details..."
                    className="resize-none bg-white"
                    rows={5}
                    value={internalCommentText}
                    onChange={(event) => {
                      setInternalCommentText(event.target.value);
                      setComposerError(null);
                    }}
                  />
                  <div className="mt-3 flex items-center justify-end">
                    <Button
                      size="sm"
                      disabled={internalCommentSaving || !internalCommentText.trim()}
                      onClick={() => void submitInternalComment()}
                    >
                      {internalCommentSaving ? "Saving..." : "Save internal comment"}
                    </Button>
                  </div>
                </div>
              ) : replyChannel === "voice" ? (
                <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-neutral-900 text-white">
                        {deskVoice.incomingCall ? (
                          <PhoneIncoming className="h-4 w-4" />
                        ) : deskVoice.activeCall ? (
                          <Phone className="h-4 w-4" />
                        ) : (
                          <PhoneCall className="h-4 w-4" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-neutral-900">Phone call</p>
                        <p className="truncate text-xs text-neutral-500">
                          {deskVoiceCall ? deskVoicePartyLabel : deskVoiceStatusLabel}
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {deskVoiceCall && !deskVoiceCallMatchesTicket ? (
                        <Badge variant="outline" className="text-[11px]">
                          Other ticket
                        </Badge>
                      ) : null}
                      <Badge variant="outline" className="text-[11px]">
                        {deskVoiceStatusLabel}
                      </Badge>
                    </div>
                  </div>

                  {deskVoice.activeCall ? (
                    <div className="mb-3 grid gap-2 sm:grid-cols-3">
                      {PHONE_KEYPAD_KEYS.map((key) => (
                        <button
                          key={key}
                          type="button"
                          className="h-10 rounded-md border border-neutral-200 bg-white text-sm font-semibold text-neutral-800 transition-colors hover:bg-neutral-100"
                          onClick={() => deskVoice.sendDigits(key)}
                        >
                          {key}
                        </button>
                      ))}
                    </div>
                  ) : null}

                  {deskVoice.incomingCall ? (
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <Button size="sm" className="gap-2" onClick={deskVoice.answerIncoming}>
                        <PhoneCall className="h-4 w-4" />
                        Answer
                      </Button>
                      <Button variant="outline" size="sm" className="gap-2" onClick={deskVoice.passIncoming}>
                        <PhoneOff className="h-4 w-4" />
                        Pass
                      </Button>
                    </div>
                  ) : deskVoice.activeCall ? (
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <Button variant="outline" size="sm" className="gap-2" onClick={deskVoice.toggleMute}>
                        {deskVoice.muted ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}
                        {deskVoice.muted ? "Unmute" : "Mute"}
                      </Button>
                      <Button variant="outline" size="sm" className="gap-2" onClick={deskVoice.toggleHold}>
                        <Pause className="h-4 w-4" />
                        {deskVoice.holdActive ? "Resume" : "Hold"}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-2 border-red-200 text-red-700 hover:bg-red-50"
                        onClick={deskVoice.endActiveCall}
                      >
                        <PhoneOff className="h-4 w-4" />
                        Hang up
                      </Button>
                    </div>
                  ) : (
                    <div className="grid gap-3">
                      <div className="rounded-lg border border-neutral-200 bg-white p-3">
                        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                          <p className="text-xs font-medium text-neutral-700">Dial</p>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8 gap-2"
                            disabled={callOptionsLoading}
                            onClick={onLoadVoiceCallOptions}
                          >
                            <PhoneCall className="h-4 w-4" />
                            {callOptionsLoading ? "Loading..." : callOptions ? "Refresh" : "Load numbers"}
                          </Button>
                        </div>

                        {callOptions ? (
                          <div className="grid gap-3">
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge variant="outline" className="text-[11px]">
                                Consent: {callOptions.consent.status || "unknown"}
                              </Badge>
                              {selectedVoiceCandidate ? (
                                <Badge variant="outline" className="text-[11px]">
                                  {selectedVoiceCandidate.phone}
                                </Badge>
                              ) : null}
                            </div>

                            {callOptions.candidates.length > 0 ? (
                              <select
                                className="h-9 rounded-md border border-neutral-200 bg-white px-3 text-sm"
                                value={selectedCallCandidateId}
                                onChange={(event) => {
                                  setSelectedCallCandidateId(event.target.value);
                                  setComposerError(null);
                                }}
                              >
                                {callOptions.candidates.map((candidate: any) => (
                                  <option key={candidate.candidateId} value={candidate.candidateId}>
                                    {candidate.phone} - {candidate.label || voiceCandidateLabel(candidate.source)}
                                  </option>
                                ))}
                                {callOptions.canManualDial ? <option value="manual">Manual number</option> : null}
                              </select>
                            ) : callOptions.canManualDial ? (
                              <Badge variant="outline" className="w-fit text-[11px]">
                                Manual number required
                              </Badge>
                            ) : (
                              <p className="text-xs text-neutral-500">No callable number is available.</p>
                            )}

                            {callOptions.canManualDial &&
                            (selectedCallCandidateId === "manual" || callOptions.candidates.length === 0) ? (
                              <Input
                                className="h-9 text-sm"
                                value={manualCallPhone}
                                onChange={(event) => {
                                  setManualCallPhone(event.target.value);
                                  setComposerError(null);
                                }}
                                placeholder="+1 555 123 4567"
                              />
                            ) : null}

                            <Textarea
                              rows={3}
                              value={callReason}
                              onChange={(event) => {
                                setCallReason(event.target.value);
                                setComposerError(null);
                              }}
                              placeholder="Reason for this call"
                              className="resize-none bg-white"
                            />
                          </div>
                        ) : (
                          <p className="text-xs text-neutral-500">Load available numbers for this ticket to place a call.</p>
                        )}

                        {callError ? <p className="mt-2 text-xs text-red-600">{callError}</p> : null}
                        {callSuccessMessage ? (
                          <p className="mt-2 text-xs text-emerald-600">{callSuccessMessage}</p>
                        ) : null}
                      </div>

                      <div className="flex flex-wrap items-center justify-end gap-2">
                        <Button
                          size="sm"
                          className="gap-2"
                          disabled={!callOptions || callOptionsLoading || callQueueing || !canQueueInlineCall}
                          onClick={() => void submitVoiceCall()}
                        >
                          <PhoneCall className="h-4 w-4" />
                          {callQueueing ? "Queueing..." : "Call"}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <>
                  <Textarea
                    placeholder={replyChannel === "whatsapp" ? "Type your WhatsApp reply..." : "Type your email reply..."}
                    className="resize-none"
                    rows={4}
                    value={replyText}
                    onChange={(event) => setReplyText(event.target.value)}
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
                          multiple={replyChannel !== "whatsapp"}
                          onChange={(event) => {
                            void handleAttachmentChange(event);
                          }}
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
                        (replyRecipientOptions.length === 0 && !recipientOverrideInput.trim())
                      }
                      onClick={() => void submitReply()}
                    >
                      {replySending
                        ? "Sending..."
                        : replyChannel === "whatsapp"
                          ? "Send WhatsApp"
                          : "Send email"}
                    </Button>
                  </div>
                </>
              )}
              {displayReplyError ? <p className="mt-2 text-xs text-red-600">{displayReplyError}</p> : null}
                      </>
                    ) : null}
                  </div>
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
                          <p className="text-xs font-medium text-neutral-800">{historyItem.ticketDisplayId}</p>
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
                          <p className="text-xs font-medium text-neutral-800">{linkedItem.ticketDisplayId}</p>
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
                ticket.tags.map((tag: string) => (
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
                {tagSuggestions.map((candidate: TagRecord) => (
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
                  {assigneeOptions.map((user: AdminUserRecord) => (
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

  if (message.channel === "internal") {
    return (
      <div className="flex justify-center">
        <div className="w-full max-w-[88%] rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-950">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="border-amber-300 bg-white text-[11px] text-amber-800">
              Internal comment
            </Badge>
            <span className="text-xs font-medium">
              {message.internal_actor_name ?? message.from.name}
            </span>
            {message.internal_origin === "ai" ? (
              <Badge variant="outline" className="border-purple-200 bg-white text-[11px] text-purple-700">
                AI
              </Badge>
            ) : null}
            <span className="text-xs text-amber-700">{formatDateRelative(message.timestamp)}</span>
          </div>
          <p className="whitespace-pre-wrap text-sm leading-relaxed">{message.body}</p>
          <p className="mt-2 text-[11px] text-amber-700">
            Internal only. Not sent to the customer.
          </p>
        </div>
      </div>
    );
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
            {message.whatsapp_status ? (() => {
              const StatusIcon = whatsappStatusIcon(message.whatsapp_status);
              const iconClass = whatsappStatusIconColor(message.whatsapp_status);
              return StatusIcon ? (
                <div className="flex items-center gap-1">
                  <StatusIcon className={iconClass} />
                </div>
              ) : null;
            })() : null}
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
  const cc = message.cc ?? [];
  const bcc = message.bcc ?? [];

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

      {(cc.length > 0 || bcc.length > 0) ? (
        <div className="mb-3 space-y-1 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs text-neutral-600">
          {cc.length > 0 ? <p className="truncate">Cc: {cc.join(", ")}</p> : null}
          {bcc.length > 0 ? <p className="truncate">Bcc: {bcc.join(", ")}</p> : null}
        </div>
      ) : null}

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
