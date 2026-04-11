import React from "react";
import { ChevronDown, Plus, Mail, Filter, GitMerge, Search, X } from "lucide-react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Checkbox } from "../components/ui/checkbox";
import { Badge } from "../components/ui/badge";
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
import { getPriorityColor, getStatusColor, formatTicketDisplayId, formatDateRelative, normalizeQueuePreviewValue } from "./utils";
import type { TicketView, TicketPriorityDisplay, TicketStatusDisplay } from "./types";
import type { TagRecord, AdminUserRecord } from "@/app/lib/api/admin";

export type SupportQueuePaneProps = {
  queuePaneWidth: number;
  setMergeType: (type: "ticket" | "customer") => void;
  setShowMergeModal: (show: boolean) => void;
  router: any;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  activeQueueFilters: Array<{
    key: "status" | "priority" | "channel" | "tag" | "assigned" | "query";
    label: string;
  }>;
  statusFilter: string;
  setStatusFilter: (status: string) => void;
  priorityFilter: "all" | TicketPriorityDisplay;
  setPriorityFilter: (priority: "all" | TicketPriorityDisplay) => void;
  channelFilter: "all" | "email" | "whatsapp" | "voice";
  setChannelFilter: (channel: "all" | "email" | "whatsapp" | "voice") => void;
  tagFilter: string;
  setTagFilter: (tag: string) => void;
  availableTags: TagRecord[];
  clearAllQueueFilters: () => void;
  clearQueueFilter: (
    key: "status" | "priority" | "channel" | "tag" | "assigned" | "query"
  ) => void;
  assignedMine: boolean;
  setAssignedMine: (mine: boolean) => void;
  activeSavedViewId: string | null;
  queueCounts: { all: number; mine: number };
  setSavedViewsOpen: (open: boolean) => void;
  selectedTickets: Set<string>;
  setBulkActionsOpen: (open: boolean) => void;
  setBulkEmailOpen: (open: boolean) => void;
  activeSavedView: any;
  tickets: TicketView[];
  toggleSelectAll: () => void;
  queueLoading: boolean;
  queueError: string | null;
  selectedTicket: any;
  setSelectedTicketId: (id: string) => void;
  toggleTicketSelection: (id: string) => void;
  assigneeNameById: Map<string, string>;
};

import { useSupportWorkspace } from "./SupportWorkspaceContext";

export function SupportQueuePane() {
  const context = useSupportWorkspace();
  
  const { router, searchQuery, setSearchQuery, activeQueueFilters, statusFilter, setStatusFilter, priorityFilter, setPriorityFilter, channelFilter, setChannelFilter, tagFilter, setTagFilter, availableTags, clearAllQueueFilters, clearQueueFilter, assignedMine, setAssignedMine, activeSavedViewId, queueCounts, setSavedViewsOpen, selectedTickets, setBulkActionsOpen, setBulkEmailOpen, activeSavedView, tickets, toggleSelectAll, queueLoading, queueError, selectedTicket, setSelectedTicketId, toggleTicketSelection, assigneeNameById, queuePaneWidth, setMergeType, setShowMergeModal } = context;

  return (
    <>
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
                  onChange={(e: any) => setSearchQuery(e.target.value)}
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
                  <DropdownMenuRadioGroup value={priorityFilter} onValueChange={(value: any) => setPriorityFilter(value as "all" | TicketPriorityDisplay)}>
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
                    onValueChange={(value: any) => setChannelFilter(value as "all" | "email" | "whatsapp" | "voice")}
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
                    {availableTags.map((tag: TagRecord) => (
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
                {activeQueueFilters.map((filter: { key: "status" | "priority" | "channel" | "tag" | "assigned" | "query"; label: string }) => (
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
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="inline-flex min-w-0 items-center gap-1 rounded-[14px] border border-neutral-200 bg-white p-1 dark:border-neutral-800 dark:bg-neutral-950/90">
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

              <div className="flex shrink-0 items-center gap-2">
                <Button
                  size="sm"
                  className="h-8 rounded-[12px] px-3.5 text-[12px] font-medium bg-neutral-900 text-white hover:bg-neutral-800 dark:bg-white dark:text-neutral-950 dark:hover:bg-neutral-100"
                  onClick={() => router.push("/tickets/new")}
                >
                  <Plus className="h-4 w-4" />
                  Create
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
              tickets.map((ticket: TicketView) => {
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
                    onClick={(e: any) => e.stopPropagation()}
                  />

                  <div className="flex-1 min-w-0">
                    {/* Header */}
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs font-medium text-neutral-600">
                            {formatTicketDisplayId(ticket.ticket_number, ticket.id)}
                          </span>
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
    </>
  );
}
