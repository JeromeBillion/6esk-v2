import React from "react";
import { Upload, X } from "lucide-react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { cn } from "../components/ui/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "../components/ui/dialog";
import { MergeModal } from "../components/MergeModal";
import { ActionFeedbackModal } from "../components/ActionFeedbackModal";
import { VoiceCallModal } from "../components/VoiceCallModal";
import { formatFileSize } from "@/app/lib/files";
import { formatTicketDisplayId, formatDateRelative } from "./utils";

export type SupportModalsProps = {
  activeSavedViewId: any; applyBulkActions: any; applySavedView: any; assigneeOptions: any; bulkActionsOpen: any; bulkAddTagsInput: any; bulkAssigneeValue: any; bulkEmailAttachments: any; bulkEmailBody: any; bulkEmailOpen: any; bulkEmailSending: any; bulkEmailSubject: any; bulkPriorityValue: any; bulkRemoveTagsInput: any; bulkStatusValue: any; bulkUpdating: any; callError: any; callOptions: any; callOptionsLoading: any; callQueueing: any; callReason: any; callSuccessMessage: any; currentUser: any; demoModeEnabled: any; feedback: any; handleBulkEmailAttachmentChange: any; loadTicketDetails: any; loadTickets: any; manualCallPhone: any; mergeType: any; newSavedViewName: any; removeSavedView: any; resetBulkEmailComposer: any; saveCurrentView: any; savedViewDeletingId: any; savedViews: any; savedViewSaving: any; savedViewsLoading: any; savedViewsOpen: any; selectedCallCandidateId: any; selectedTicket: any; selectedTicketId: any; selectedTickets: any; setBulkActionsOpen: any; setBulkAddTagsInput: any; setBulkAssigneeValue: any; setBulkEmailAttachments: any; setBulkEmailBody: any; setBulkEmailOpen: any; setBulkEmailSubject: any; setBulkPriorityValue: any; setBulkRemoveTagsInput: any; setBulkStatusValue: any; setCallReason: any; setFeedback: any; setManualCallPhone: any; setNewSavedViewName: any; setSavedViewsOpen: any; setSelectedCallCandidateId: any; setShowMergeModal: any; setVoiceModalOpen: any; showMergeModal: any; submitBulkEmail: any; submitVoiceCall: any; voiceModalOpen: any;
};

import { useSupportWorkspace } from "./SupportWorkspaceContext";

export function SupportModals() {
  const context = useSupportWorkspace();
  
  const { activeSavedViewId, applyBulkActions, applySavedView, assigneeOptions, bulkActionsOpen, bulkAddTagsInput, bulkAssigneeValue, bulkEmailAttachments, bulkEmailBody, bulkEmailOpen, bulkEmailSending, bulkEmailSubject, bulkPriorityValue, bulkRemoveTagsInput, bulkStatusValue, bulkUpdating, callError, callOptions, callOptionsLoading, callQueueing, callReason, callSuccessMessage, currentUser, demoModeEnabled, feedback, handleBulkEmailAttachmentChange, loadTicketDetails, loadTickets, manualCallPhone, mergeType, newSavedViewName, removeSavedView, resetBulkEmailComposer, saveCurrentView, savedViewDeletingId, savedViews, savedViewSaving, savedViewsLoading, savedViewsOpen, selectedCallCandidateId, selectedTicket, selectedTicketId, selectedTickets, setBulkActionsOpen, setBulkAddTagsInput, setBulkAssigneeValue, setBulkEmailAttachments, setBulkEmailBody, setBulkEmailOpen, setBulkEmailSubject, setBulkPriorityValue, setBulkRemoveTagsInput, setBulkStatusValue, setCallReason, setFeedback, setManualCallPhone, setNewSavedViewName, setSavedViewsOpen, setSelectedCallCandidateId, setShowMergeModal, setVoiceModalOpen, showMergeModal, submitBulkEmail, submitVoiceCall, voiceModalOpen } = context;

  return (
    <>

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
                  onChange={(event: any) => setNewSavedViewName(event.target.value)}
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
                savedViews.map((view: any) => (
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
                    setBulkStatusValue((event.target.value as any) || "")
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
                    setBulkPriorityValue((event.target.value as any) || "")
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
                  {assigneeOptions.map((user: any) => (
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
                onChange={(event: any) => setBulkAddTagsInput(event.target.value)}
                placeholder="urgent, vip"
                disabled={bulkUpdating}
              />
            </label>

            <label className="grid gap-1.5 text-xs font-medium text-neutral-600">
              Remove tags (comma separated)
              <Input
                value={bulkRemoveTagsInput}
                onChange={(event: any) => setBulkRemoveTagsInput(event.target.value)}
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
        onOpenChange={(open: any) => {
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
                onChange={(event: any) => setBulkEmailSubject(event.target.value)}
                placeholder="Quarterly product update"
                disabled={bulkEmailSending}
              />
            </label>

            <label className="grid gap-1.5 text-xs font-medium text-neutral-600 dark:text-neutral-300">
              Email body
              <Textarea
                rows={8}
                value={bulkEmailBody}
                onChange={(event: any) => setBulkEmailBody(event.target.value)}
                placeholder="Write the email that should be sent to every resolved customer address."
                disabled={bulkEmailSending}
              />
            </label>

            {bulkEmailAttachments.length > 0 ? (
              <div className="space-y-2">
                {bulkEmailAttachments.map((attachment: any) => (
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
                        setBulkEmailAttachments((previous: any) =>
                          previous.filter((entry: any) => entry.id !== attachment.id)
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
                  onChange={(event: any) => {
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
        ticketLabel={
          selectedTicket
            ? `${formatTicketDisplayId(selectedTicket.ticket_number, selectedTicket.id)} • ${selectedTicket.subject}`
            : "Voice call"
        }
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
          setFeedback((previous: any) => ({
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
