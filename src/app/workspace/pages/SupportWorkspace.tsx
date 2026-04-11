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
// ── Shared types and utilities ──────────────────────────────────
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

// ── Local React hooks & components (use React primitives, cannot be extracted to pure utils) ──

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

import { SupportWorkspaceProvider, useSupportWorkspace } from "../support/SupportWorkspaceContext";

function SupportWorkspaceLayout() {
  const { workspaceLayoutRef, queuePaneWidth, startQueueResize, selectedTicket } = useSupportWorkspace();

  return (
    <>
      <div ref={workspaceLayoutRef} className="h-full flex min-w-0">
        {/* Ticket Queue */}
        <SupportQueuePane />

        <ResizeHandle orientation="vertical" onPointerDown={startQueueResize} />

        {/* Ticket Detail */}
        <div className="min-w-0 flex-1 bg-neutral-50 flex items-center justify-center">
          {selectedTicket ? (
            <TicketDetail />
          ) : (
            <div className="text-center">
              <p className="text-neutral-600 mb-1">Select a ticket to view details</p>
              <p className="text-xs text-neutral-500">Choose from the list on the left</p>
            </div>
          )}
        </div>
      </div>

      <SupportModals />
    </>
  );
}

export function SupportWorkspace() {
  return (
    <SupportWorkspaceProvider>
      <SupportWorkspaceLayout />
    </SupportWorkspaceProvider>
  );
}
