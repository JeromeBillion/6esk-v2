import { Phone, ShieldAlert } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Badge } from "./ui/badge";
import { Textarea } from "./ui/textarea";
import { cn } from "./ui/utils";
import type { TicketCallOptions } from "@/app/lib/api/support";

type VoiceCallModalProps = {
  open: boolean;
  onClose: () => void;
  ticketLabel: string;
  options: TicketCallOptions | null;
  loading: boolean;
  queueing: boolean;
  error: string | null;
  successMessage: string | null;
  selectedCandidateId: string;
  manualPhone: string;
  reason: string;
  onSelectedCandidateIdChange: (value: string) => void;
  onManualPhoneChange: (value: string) => void;
  onReasonChange: (value: string) => void;
  onQueue: () => void;
};

function consentTone(status: string | null | undefined) {
  if ((status ?? "").toLowerCase() === "granted") return "text-emerald-700 bg-emerald-50 border-emerald-200";
  if ((status ?? "").toLowerCase() === "revoked") return "text-red-700 bg-red-50 border-red-200";
  return "text-amber-700 bg-amber-50 border-amber-200";
}

function candidateLabel(source: TicketCallOptions["candidates"][number]["source"]) {
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

export function VoiceCallModal({
  open,
  onClose,
  ticketLabel,
  options,
  loading,
  queueing,
  error,
  successMessage,
  selectedCandidateId,
  manualPhone,
  reason,
  onSelectedCandidateIdChange,
  onManualPhoneChange,
  onReasonChange,
  onQueue
}: VoiceCallModalProps) {
  const isConsentRevoked = options?.consent.status === "revoked";
  const canQueue = Boolean(manualPhone.trim() || selectedCandidateId.trim()) && reason.trim().length > 0 && !isConsentRevoked;

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Phone className="h-5 w-5" />
            Voice Call
          </DialogTitle>
          <DialogDescription>{ticketLabel}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {loading ? <p className="text-sm text-neutral-600">Loading call options...</p> : null}

          {options ? (
            <>
              <div className={cn("rounded-xl border p-3 text-sm", consentTone(options.consent.status))}>
                <div className="flex items-center gap-2">
                  <ShieldAlert className="h-4 w-4" />
                  <span className="font-medium">Consent: {options.consent.status || "unknown"}</span>
                </div>
                {options.consent.reason ? <p className="mt-2 text-xs">{options.consent.reason}</p> : null}
                {options.consent.updatedAt ? (
                  <p className="mt-2 text-xs">
                    Updated {new Date(options.consent.updatedAt).toLocaleString()}
                  </p>
                ) : null}
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-neutral-900">Suggested numbers</p>
                  <Badge variant="outline" className="text-[11px]">
                    {options.candidates.length} option{options.candidates.length === 1 ? "" : "s"}
                  </Badge>
                </div>

                {options.candidates.length > 0 ? (
                  <div className="space-y-2">
                    {options.candidates.map((candidate) => {
                      const active = selectedCandidateId === candidate.candidateId;
                      return (
                        <button
                          key={candidate.candidateId}
                          type="button"
                          className={cn(
                            "w-full rounded-xl border p-3 text-left transition-colors",
                            active ? "border-blue-300 bg-blue-50" : "border-neutral-200 bg-white hover:bg-neutral-50"
                          )}
                          onClick={() => onSelectedCandidateIdChange(candidate.candidateId)}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <p className="text-sm font-medium text-neutral-900">{candidate.phone}</p>
                              <p className="mt-1 text-xs text-neutral-500">
                                {candidate.label || candidateLabel(candidate.source)}
                              </p>
                            </div>
                            {candidate.isPrimary ? (
                              <Badge variant="outline" className="text-[11px]">
                                Primary
                              </Badge>
                            ) : null}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-neutral-200 bg-neutral-50 p-4 text-sm text-neutral-500">
                    No saved numbers were found for this ticket.
                  </div>
                )}
              </div>

              {options.canManualDial ? (
                <div className="space-y-2">
                  <label className="text-xs font-medium text-neutral-600">Manual phone override</label>
                  <Input
                    placeholder="+1 555 123 4567"
                    value={manualPhone}
                    onChange={(event) => onManualPhoneChange(event.target.value)}
                  />
                </div>
              ) : null}

              <div className="space-y-2">
                <label className="text-xs font-medium text-neutral-600">Reason</label>
                <Textarea
                  rows={4}
                  value={reason}
                  onChange={(event) => onReasonChange(event.target.value)}
                  placeholder="Explain why the call is needed."
                  className="resize-none"
                />
              </div>
            </>
          ) : null}

          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          {successMessage ? <p className="text-sm text-emerald-600">{successMessage}</p> : null}

          <div className="flex items-center justify-end gap-2 border-t border-neutral-200 pt-4">
            <Button variant="outline" onClick={onClose}>
              Close
            </Button>
            <Button onClick={onQueue} disabled={loading || queueing || !canQueue}>
              {queueing ? "Queueing..." : "Queue Call"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
