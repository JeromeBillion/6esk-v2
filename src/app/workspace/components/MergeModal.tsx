import { useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, Search, X } from "lucide-react";
import { MERGE_IRREVERSIBLE_ACK_TEXT } from "@/lib/merge/constants";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Separator } from "./ui/separator";
import { cn } from "./ui/utils";

type MergeType = "ticket" | "customer";
type MergeStep = "search" | "select" | "preflight" | "success" | "error";

type TicketCandidate = {
  id: string;
  subject: string | null;
  requesterEmail: string;
  status: string;
  priority: string;
  channel: "email" | "whatsapp" | "voice";
};

type CustomerCandidate = {
  id: string;
  kind: "registered" | "unregistered";
  displayName: string | null;
  primaryEmail: string | null;
  primaryPhone: string | null;
  externalSystem: string | null;
  externalUserId: string | null;
  activeTicketCount: number;
};

type Candidate = {
  id: string;
  type: MergeType;
  display: string;
  email?: string | null;
  phone?: string | null;
  metadata: string;
  raw: TicketCandidate | CustomerCandidate;
};

interface MergeModalProps {
  open: boolean;
  onClose: () => void;
  type: MergeType;
  onMerged?: () => void;
}

export function MergeModal({ open, onClose, type, onMerged }: MergeModalProps) {
  const [step, setStep] = useState<MergeStep>("search");
  const [searchQuery, setSearchQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [selectedSource, setSelectedSource] = useState<Candidate | null>(null);
  const [selectedTarget, setSelectedTarget] = useState<Candidate | null>(null);
  const [preflightLoading, setPreflightLoading] = useState(false);
  const [preflightError, setPreflightError] = useState<string | null>(null);
  const [preflightData, setPreflightData] = useState<{
    source: Candidate;
    target: Candidate;
    impacts: Array<{ label: string; count: number }>;
    conflicts: string[];
    warnings: string[];
  } | null>(null);
  const [mergeSubmitting, setMergeSubmitting] = useState(false);
  const [acknowledgement, setAcknowledgement] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const targetOptions = useMemo(() => {
    if (!selectedSource) return candidates;
    return candidates.filter((candidate) => candidate.id !== selectedSource.id);
  }, [candidates, selectedSource]);

  const acknowledgementMatches = acknowledgement.trim() === MERGE_IRREVERSIBLE_ACK_TEXT;

  function resetState() {
    setStep("search");
    setSearchQuery("");
    setSearching(false);
    setSearchError(null);
    setCandidates([]);
    setSelectedSource(null);
    setSelectedTarget(null);
    setPreflightLoading(false);
    setPreflightError(null);
    setPreflightData(null);
    setMergeSubmitting(false);
    setAcknowledgement("");
    setErrorMessage("");
  }

  function handleClose() {
    resetState();
    onClose();
  }

  function normalizeTicketCandidate(candidate: TicketCandidate): Candidate {
    return {
      id: candidate.id,
      type: "ticket",
      display: candidate.id,
      email: candidate.requesterEmail,
      phone: null,
      metadata: `${candidate.subject ?? "(no subject)"} · ${candidate.status} · ${candidate.priority} · ${candidate.channel}`,
      raw: candidate,
    };
  }

  function normalizeCustomerCandidate(candidate: CustomerCandidate): Candidate {
    return {
      id: candidate.id,
      type: "customer",
      display: candidate.displayName ?? candidate.primaryEmail ?? candidate.id,
      email: candidate.primaryEmail,
      phone: candidate.primaryPhone,
      metadata: `${candidate.kind} · ${candidate.activeTicketCount} active tickets`,
      raw: candidate,
    };
  }

  async function handleSearch() {
    const query = searchQuery.trim();
    if (!query) return;

    setSearching(true);
    setSearchError(null);
    setCandidates([]);
    setSelectedSource(null);
    setSelectedTarget(null);

    const endpoint =
      type === "ticket"
        ? `/api/tickets/search?q=${encodeURIComponent(query)}&limit=30`
        : `/api/customers/search?q=${encodeURIComponent(query)}&limit=30`;

    try {
      const response = await fetch(endpoint);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setSearchError(payload.error ?? "Search failed.");
        return;
      }

      const nextCandidates =
        type === "ticket"
          ? ((payload.tickets ?? []) as TicketCandidate[]).map(normalizeTicketCandidate)
          : ((payload.customers ?? []) as CustomerCandidate[]).map(normalizeCustomerCandidate);

      setCandidates(nextCandidates);
      setStep("select");
    } catch (error) {
      setSearchError(error instanceof Error ? error.message : "Search failed.");
    } finally {
      setSearching(false);
    }
  }

  async function handleRunPreflight() {
    if (!selectedSource || !selectedTarget) return;

    setPreflightLoading(true);
    setPreflightError(null);
    setPreflightData(null);

    const endpoint =
      type === "ticket" ? "/api/tickets/merge/preflight" : "/api/customers/merge/preflight";
    const body =
      type === "ticket"
        ? {
            sourceTicketId: selectedSource.id,
            targetTicketId: selectedTarget.id,
          }
        : {
            sourceCustomerId: selectedSource.id,
            targetCustomerId: selectedTarget.id,
          };

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setPreflightError(payload.error ?? "Failed to preflight merge.");
        return;
      }

      if (type === "ticket") {
        const preflight = payload.preflight as {
          moveCounts: {
            messages: number;
            replies: number;
            events: number;
            drafts: number;
            sourceTags: number;
            newTagsOnTarget: number;
          };
          blockingReason: string | null;
        };

        setPreflightData({
          source: selectedSource,
          target: selectedTarget,
          impacts: [
            { label: "Messages", count: preflight.moveCounts.messages },
            { label: "Replies", count: preflight.moveCounts.replies },
            { label: "Events", count: preflight.moveCounts.events },
            { label: "Drafts", count: preflight.moveCounts.drafts },
            { label: "Source tags", count: preflight.moveCounts.sourceTags },
            { label: "New target tags", count: preflight.moveCounts.newTagsOnTarget },
          ],
          conflicts: preflight.blockingReason ? [preflight.blockingReason] : [],
          warnings: ["This action is irreversible.", "All source ticket data will move into target."],
        });
      } else {
        const preflight = payload.preflight as {
          moveCounts: {
            totalTickets: number;
            activeTickets: number;
            activeEmailTickets: number;
            activeWhatsappTickets: number;
            sourceIdentities: number;
            identitiesToMove: number;
            identityConflicts: number;
          };
          blockingReason: string | null;
        };

        setPreflightData({
          source: selectedSource,
          target: selectedTarget,
          impacts: [
            { label: "Tickets to relink", count: preflight.moveCounts.totalTickets },
            { label: "Active tickets", count: preflight.moveCounts.activeTickets },
            { label: "Active email", count: preflight.moveCounts.activeEmailTickets },
            { label: "Active WhatsApp", count: preflight.moveCounts.activeWhatsappTickets },
            { label: "Source identities", count: preflight.moveCounts.sourceIdentities },
            { label: "Identities to move", count: preflight.moveCounts.identitiesToMove },
          ],
          conflicts:
            preflight.moveCounts.identityConflicts > 0
              ? [`${preflight.moveCounts.identityConflicts} identity conflict(s) detected.`]
              : preflight.blockingReason
                ? [preflight.blockingReason]
                : [],
          warnings: ["This action is irreversible.", "All source customer data will merge into target."],
        });
      }

      setStep("preflight");
    } catch (error) {
      setPreflightError(error instanceof Error ? error.message : "Failed to preflight merge.");
    } finally {
      setPreflightLoading(false);
    }
  }

  async function handleConfirmMerge() {
    if (!selectedSource || !selectedTarget) return;

    setMergeSubmitting(true);
    const endpoint = type === "ticket" ? "/api/tickets/merge" : "/api/customers/merge";
    const body =
      type === "ticket"
        ? {
            sourceTicketId: selectedSource.id,
            targetTicketId: selectedTarget.id,
            acknowledgement: MERGE_IRREVERSIBLE_ACK_TEXT,
            reason: null,
          }
        : {
            sourceCustomerId: selectedSource.id,
            targetCustomerId: selectedTarget.id,
            acknowledgement: MERGE_IRREVERSIBLE_ACK_TEXT,
            reason: null,
          };

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setErrorMessage(payload.error ?? "Merge failed.");
        setStep("error");
        return;
      }

      setStep("success");
      if (onMerged) onMerged();
      setTimeout(() => {
        handleClose();
      }, 1500);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Merge failed.");
      setStep("error");
    } finally {
      setMergeSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && handleClose()}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
        {step === "search" ? (
          <>
            <DialogHeader>
              <DialogTitle>Merge {type === "ticket" ? "Tickets" : "Customers"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium mb-2 block">
                  Search for {type === "ticket" ? "tickets" : "customers"} to merge
                </label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" />
                    <Input
                      placeholder={
                        type === "ticket" ? "Ticket ID, requester email, subject..." : "Email, phone, name..."
                      }
                      className="pl-9"
                      value={searchQuery}
                      onChange={(event) => setSearchQuery(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          void handleSearch();
                        }
                      }}
                    />
                  </div>
                  <Button onClick={() => void handleSearch()} disabled={searching || !searchQuery.trim()}>
                    {searching ? "Searching..." : "Search"}
                  </Button>
                </div>
                {searchError ? <p className="text-sm text-red-600 mt-2">{searchError}</p> : null}
              </div>
            </div>
          </>
        ) : null}

        {step === "select" ? (
          <>
            <DialogHeader>
              <DialogTitle>Select {type === "ticket" ? "Tickets" : "Customers"} to Merge</DialogTitle>
            </DialogHeader>
            <div className="flex-1 overflow-y-auto space-y-4">
              {candidates.length === 0 ? (
                <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-6 text-center">
                  <p className="text-sm font-medium text-neutral-900 mb-1">No candidates found</p>
                  <p className="text-xs text-neutral-500">
                    Try searching by ticket number, customer email, phone, or subject keywords.
                  </p>
                </div>
              ) : null}
              <div>
                <label className="text-sm font-medium mb-2 block">Source (will be merged into target)</label>
                <div className="space-y-2">
                  {candidates.map((candidate) => (
                    <button
                      key={candidate.id}
                      type="button"
                      className={cn(
                        "w-full text-left border rounded-lg p-3 transition-colors",
                        selectedSource?.id === candidate.id
                          ? "border-blue-500 bg-blue-50"
                          : "border-neutral-200 hover:border-neutral-300"
                      )}
                      onClick={() => {
                        setSelectedSource(candidate);
                        if (selectedTarget?.id === candidate.id) {
                          setSelectedTarget(null);
                        }
                      }}
                    >
                      <p className="font-medium text-sm">{candidate.display}</p>
                      {candidate.email ? <p className="text-xs text-neutral-600">{candidate.email}</p> : null}
                      {candidate.phone ? <p className="text-xs text-neutral-600">{candidate.phone}</p> : null}
                      <p className="text-xs text-neutral-500 mt-1">{candidate.metadata}</p>
                    </button>
                  ))}
                </div>
              </div>

              {selectedSource ? (
                <>
                  <Separator />
                  <div>
                    <label className="text-sm font-medium mb-2 block">Target (will receive all data)</label>
                    {targetOptions.length === 0 ? (
                      <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-4">
                        <p className="text-sm font-medium text-neutral-900 mb-1">No valid target available</p>
                        <p className="text-xs text-neutral-500">
                          Select at least two records in search results to run a merge.
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {targetOptions.map((candidate) => (
                          <button
                            key={candidate.id}
                            type="button"
                            className={cn(
                              "w-full text-left border rounded-lg p-3 transition-colors",
                              selectedTarget?.id === candidate.id
                                ? "border-blue-500 bg-blue-50"
                                : "border-neutral-200 hover:border-neutral-300"
                            )}
                            onClick={() => setSelectedTarget(candidate)}
                          >
                            <p className="font-medium text-sm">{candidate.display}</p>
                            {candidate.email ? <p className="text-xs text-neutral-600">{candidate.email}</p> : null}
                            {candidate.phone ? <p className="text-xs text-neutral-600">{candidate.phone}</p> : null}
                            <p className="text-xs text-neutral-500 mt-1">{candidate.metadata}</p>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              ) : null}
            </div>
            <div className="flex items-center justify-between pt-4 border-t">
              <Button variant="outline" onClick={() => setStep("search")}>
                Back
              </Button>
              <Button onClick={() => void handleRunPreflight()} disabled={!selectedSource || !selectedTarget || preflightLoading}>
                {preflightLoading ? "Checking..." : "Continue to Preflight"}
              </Button>
            </div>
            {preflightError ? <p className="text-sm text-red-600 mt-2">{preflightError}</p> : null}
          </>
        ) : null}

        {step === "preflight" && preflightData ? (
          <>
            <DialogHeader>
              <DialogTitle>Confirm Merge</DialogTitle>
            </DialogHeader>
            <div className="flex-1 overflow-y-auto space-y-4">
              <div className="flex items-center justify-center gap-4 p-4 bg-neutral-50 rounded-lg">
                <div className="text-center">
                  <p className="text-xs text-neutral-600 mb-1">Source</p>
                  <p className="font-medium">{preflightData.source.display}</p>
                  <p className="text-xs text-neutral-500">{preflightData.source.email}</p>
                </div>
                <ArrowRight className="w-5 h-5 text-neutral-400" />
                <div className="text-center">
                  <p className="text-xs text-neutral-600 mb-1">Target</p>
                  <p className="font-medium">{preflightData.target.display}</p>
                  <p className="text-xs text-neutral-500">{preflightData.target.email}</p>
                </div>
              </div>

              <div>
                <h4 className="text-sm font-medium mb-2">Data to be moved</h4>
                <div className="grid grid-cols-2 gap-2">
                  {preflightData.impacts.map((impact) => (
                    <div key={impact.label} className="flex items-center justify-between p-2 bg-neutral-50 rounded">
                      <span className="text-sm text-neutral-700">{impact.label}</span>
                      <Badge variant="secondary">{impact.count}</Badge>
                    </div>
                  ))}
                </div>
              </div>

              {preflightData.conflicts.length > 0 ? (
                <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
                  <div className="flex gap-2 mb-2">
                    <AlertTriangle className="w-4 h-4 text-orange-600 mt-0.5" />
                    <h4 className="text-sm font-medium text-orange-900">Conflicts Detected</h4>
                  </div>
                  <ul className="space-y-1">
                    {preflightData.conflicts.map((conflict) => (
                      <li key={conflict} className="text-sm text-orange-800">
                        • {conflict}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                <div className="flex gap-2 mb-2">
                  <AlertTriangle className="w-4 h-4 text-red-600 mt-0.5" />
                  <h4 className="text-sm font-medium text-red-900">Important Warnings</h4>
                </div>
                <ul className="space-y-1">
                  {preflightData.warnings.map((warning) => (
                    <li key={warning} className="text-sm text-red-800">
                      • {warning}
                    </li>
                  ))}
                </ul>
              </div>

              <div>
                <label className="text-sm font-medium mb-2 block">
                  Type acknowledgment to continue
                </label>
                <Input
                  value={acknowledgement}
                  onChange={(event) => setAcknowledgement(event.target.value)}
                  placeholder={MERGE_IRREVERSIBLE_ACK_TEXT}
                />
                {acknowledgement && !acknowledgementMatches ? (
                  <p className="text-xs text-red-600 mt-2">Acknowledgment text does not match.</p>
                ) : null}
              </div>
            </div>
            <div className="flex items-center justify-between pt-4 border-t">
              <Button variant="outline" onClick={() => setStep("select")}>
                Back
              </Button>
              <Button
                variant="destructive"
                onClick={() => void handleConfirmMerge()}
                disabled={mergeSubmitting || !acknowledgementMatches}
              >
                {mergeSubmitting ? "Merging..." : "Confirm Merge"}
              </Button>
            </div>
          </>
        ) : null}

        {step === "success" ? (
          <div className="flex flex-col items-center justify-center py-12">
            <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mb-4">
              <svg
                className="w-8 h-8 text-green-600"
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path d="M5 13l4 4L19 7"></path>
              </svg>
            </div>
            <h3 className="text-lg font-semibold mb-2">Merge Successful</h3>
            <p className="text-sm text-neutral-600">
              {type === "ticket" ? "Tickets" : "Customers"} have been merged successfully.
            </p>
          </div>
        ) : null}

        {step === "error" ? (
          <>
            <DialogHeader>
              <DialogTitle>Merge Failed</DialogTitle>
            </DialogHeader>
            <div className="flex flex-col items-center justify-center py-8">
              <div className="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center mb-4">
                <X className="w-8 h-8 text-red-600" />
              </div>
              <h3 className="text-lg font-semibold mb-2">Something went wrong</h3>
              <p className="text-sm text-neutral-600 text-center mb-4">{errorMessage}</p>
            </div>
            <div className="flex justify-end pt-4 border-t">
              <Button onClick={handleClose}>Close</Button>
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
