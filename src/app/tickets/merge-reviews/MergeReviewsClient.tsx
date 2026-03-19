"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, Check, GitMerge, Search, X } from "lucide-react";
import AppShell from "@/app/components/AppShell";
import { ActionFeedbackModal } from "@/app/workspace/components/ActionFeedbackModal";
import { Badge } from "@/app/workspace/components/ui/badge";
import { Button } from "@/app/workspace/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/app/workspace/components/ui/card";
import { Input } from "@/app/workspace/components/ui/input";
import { Textarea } from "@/app/workspace/components/ui/textarea";
import {
  listMergeReviews,
  resolveMergeReview,
  type MergeReviewQueueItem,
  type MergeReviewStatus
} from "@/app/lib/api/merge-reviews";
import { ApiError, isAbortError } from "@/app/lib/api/http";

const STATUS_OPTIONS: Array<Exclude<MergeReviewStatus, "all"> | "all"> = [
  "pending",
  "applied",
  "approved",
  "rejected",
  "failed",
  "all"
];

type FeedbackState = {
  open: boolean;
  tone: "success" | "error" | "info";
  title: string;
  message: string;
  autoCloseMs?: number;
};

function formatDate(value: string | null | undefined) {
  if (!value) return "-";
  return new Date(value).toLocaleString();
}

function typeBadge(item: MergeReviewQueueItem) {
  return item.proposal_type === "ticket" ? "Ticket merge" : "Customer merge";
}

function primaryLabel(item: MergeReviewQueueItem) {
  if (item.proposal_type === "ticket") {
    return `${item.source_ticket_id} -> ${item.target_ticket_id}`;
  }
  return `${item.source_customer_display_name ?? item.source_customer_primary_email ?? item.source_customer_id} -> ${item.target_customer_display_name ?? item.target_customer_primary_email ?? item.target_customer_id}`;
}

export default function MergeReviewsClient() {
  const searchParams = useSearchParams();
  const paramsKey = searchParams.toString();
  const [status, setStatus] = useState<MergeReviewStatus>("pending");
  const [query, setQuery] = useState("");
  const [assignedMine, setAssignedMine] = useState(true);
  const [reviews, setReviews] = useState<MergeReviewQueueItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [noteById, setNoteById] = useState<Record<string, string>>({});
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<FeedbackState>({
    open: false,
    tone: "info",
    title: "",
    message: ""
  });

  useEffect(() => {
    const nextStatus = searchParams.get("status");
    if (nextStatus && STATUS_OPTIONS.includes(nextStatus as MergeReviewStatus)) {
      setStatus(nextStatus as MergeReviewStatus);
    } else {
      setStatus("pending");
    }

    setQuery(searchParams.get("q") ?? "");
    const assigned = searchParams.get("assigned");
    setAssignedMine(assigned !== "any");
  }, [paramsKey, searchParams]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void listMergeReviews(
      {
        status,
        query,
        assigned: assignedMine ? "mine" : undefined,
        limit: 100,
        signal: controller.signal
      }
    )
      .then(setReviews)
      .catch((loadError) => {
        if (isAbortError(loadError)) return;
        setReviews([]);
        setError(loadError instanceof Error ? loadError.message : "Failed to load merge reviews");
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [assignedMine, query, status]);

  const pendingCount = useMemo(
    () => reviews.filter((review) => review.status === "pending").length,
    [reviews]
  );

  async function handleDecision(review: MergeReviewQueueItem, decision: "approve" | "reject") {
    setSubmittingId(review.id);
    setError(null);
    try {
      await resolveMergeReview(review.id, {
        decision,
        note: noteById[review.id]?.trim() || null
      });
      setFeedback({
        open: true,
        tone: "success",
        title: decision === "approve" ? "Merge approved" : "Merge rejected",
        message:
          decision === "approve"
            ? "The merge review was resolved and the queue has been refreshed."
            : "The merge review was rejected and removed from the active queue.",
        autoCloseMs: 1500
      });
      setReviews((previous) => previous.filter((item) => item.id !== review.id));
      setNoteById((previous) => ({ ...previous, [review.id]: "" }));
    } catch (decisionError) {
      const message =
        decisionError instanceof ApiError
          ? decisionError.message
          : decisionError instanceof Error
            ? decisionError.message
            : "Failed to update merge review";
      setFeedback({
        open: true,
        tone: "error",
        title: "Merge review failed",
        message
      });
    } finally {
      setSubmittingId(null);
    }
  }

  return (
    <AppShell>
      <div className="h-full overflow-y-auto bg-neutral-50">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="mb-2 flex items-center gap-2">
                <Button asChild variant="ghost" size="sm" className="gap-2 -ml-3">
                  <Link href="/tickets">
                    <ArrowLeft className="h-4 w-4" />
                    Back to Support
                  </Link>
                </Button>
              </div>
              <h1 className="text-2xl font-semibold text-neutral-900">Merge Reviews</h1>
              <p className="mt-1 text-sm text-neutral-600">
                Resolve pending ticket and customer merge proposals without leaving the support workflow.
              </p>
            </div>
            <Card className="min-w-56">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Queue Snapshot</CardTitle>
                <CardDescription>Support-adjacent review queue</CardDescription>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-xs text-neutral-500">Loaded</p>
                  <p className="text-lg font-semibold text-neutral-900">{reviews.length}</p>
                </div>
                <div>
                  <p className="text-xs text-neutral-500">Pending</p>
                  <p className="text-lg font-semibold text-neutral-900">{pendingCount}</p>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardContent className="flex flex-col gap-4 pt-6">
              <div className="flex flex-wrap items-center gap-2">
                {STATUS_OPTIONS.map((option) => (
                  <Button
                    key={option}
                    variant={status === option ? "default" : "outline"}
                    size="sm"
                    onClick={() => setStatus(option)}
                  >
                    {option === "all" ? "All" : option.charAt(0).toUpperCase() + option.slice(1)}
                  </Button>
                ))}
                <Button
                  variant={assignedMine ? "default" : "outline"}
                  size="sm"
                  className="ml-auto"
                  onClick={() => setAssignedMine((previous) => !previous)}
                >
                  {assignedMine ? "Assigned: Mine" : "Assigned: Any"}
                </Button>
              </div>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
                <Input
                  className="pl-9"
                  placeholder="Search by ticket, customer, reason, or email"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </div>
            </CardContent>
          </Card>

          {loading ? <p className="text-sm text-neutral-600">Loading merge review queue...</p> : null}
          {error ? <p className="text-sm text-red-600">{error}</p> : null}

          {!loading && !error && reviews.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center gap-2 py-16 text-center">
                <GitMerge className="h-10 w-10 text-neutral-300" />
                <p className="text-sm font-medium text-neutral-900">No merge reviews found</p>
                <p className="max-w-md text-xs text-neutral-500">
                  Adjust the queue filter or search. Pending and recently resolved reviews will appear here.
                </p>
              </CardContent>
            </Card>
          ) : null}

          {!loading && !error
            ? reviews.map((review) => {
                const isPending = review.status === "pending";
                return (
                  <Card key={review.id}>
                    <CardHeader className="gap-3">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant="outline">{typeBadge(review)}</Badge>
                            <Badge variant={isPending ? "secondary" : "outline"}>{review.status}</Badge>
                            {typeof review.confidence === "number" ? (
                              <Badge variant="outline">{Math.round(review.confidence * 100)}% confidence</Badge>
                            ) : null}
                          </div>
                          <CardTitle className="text-base">{primaryLabel(review)}</CardTitle>
                          <CardDescription>
                            Proposed {formatDate(review.created_at)}
                            {review.reason ? ` • ${review.reason}` : ""}
                          </CardDescription>
                        </div>
                        <div className="text-right text-xs text-neutral-500">
                          <p>Review ID</p>
                          <p className="font-medium text-neutral-700">{review.id}</p>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
                      <div className="grid gap-4 md:grid-cols-2">
                        <div className="rounded-xl border border-neutral-200 bg-white p-4">
                          <p className="mb-2 text-xs font-medium uppercase tracking-[0.16em] text-neutral-500">
                            Source
                          </p>
                          <p className="text-sm font-medium text-neutral-900">
                            {review.source_ticket_subject ??
                              review.source_customer_display_name ??
                              review.source_ticket_id ??
                              review.source_customer_id}
                          </p>
                          {review.source_ticket_requester_email || review.source_customer_primary_email ? (
                            <p className="mt-1 text-xs text-neutral-600">
                              {review.source_ticket_requester_email ?? review.source_customer_primary_email}
                            </p>
                          ) : null}
                          {review.source_customer_primary_phone ? (
                            <p className="mt-1 text-xs text-neutral-600">{review.source_customer_primary_phone}</p>
                          ) : null}
                        </div>
                        <div className="rounded-xl border border-neutral-200 bg-white p-4">
                          <p className="mb-2 text-xs font-medium uppercase tracking-[0.16em] text-neutral-500">
                            Target
                          </p>
                          <p className="text-sm font-medium text-neutral-900">
                            {review.target_ticket_subject ??
                              review.target_customer_display_name ??
                              review.target_ticket_id ??
                              review.target_customer_id}
                          </p>
                          {review.target_ticket_requester_email || review.target_customer_primary_email ? (
                            <p className="mt-1 text-xs text-neutral-600">
                              {review.target_ticket_requester_email ?? review.target_customer_primary_email}
                            </p>
                          ) : null}
                          {review.target_customer_primary_phone ? (
                            <p className="mt-1 text-xs text-neutral-600">{review.target_customer_primary_phone}</p>
                          ) : null}
                        </div>
                      </div>

                      <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-4">
                        <p className="mb-2 text-xs font-medium uppercase tracking-[0.16em] text-neutral-500">
                          Resolution Note
                        </p>
                        <Textarea
                          rows={4}
                          placeholder="Optional note for the audit trail"
                          value={noteById[review.id] ?? ""}
                          onChange={(event) =>
                            setNoteById((previous) => ({
                              ...previous,
                              [review.id]: event.target.value
                            }))
                          }
                          disabled={!isPending || submittingId === review.id}
                        />
                        {review.failure_reason ? (
                          <p className="mt-3 text-xs text-red-600">Failure reason: {review.failure_reason}</p>
                        ) : null}
                        {isPending ? (
                          <div className="mt-4 flex flex-wrap justify-end gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={submittingId === review.id}
                              onClick={() => void handleDecision(review, "reject")}
                            >
                              <X className="h-4 w-4" />
                              Reject
                            </Button>
                            <Button
                              size="sm"
                              disabled={submittingId === review.id}
                              onClick={() => void handleDecision(review, "approve")}
                            >
                              <Check className="h-4 w-4" />
                              Approve
                            </Button>
                          </div>
                        ) : (
                          <p className="mt-4 text-xs text-neutral-500">
                            Resolved {formatDate(review.reviewed_at ?? review.applied_at)}
                          </p>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })
            : null}
        </div>
      </div>

      <ActionFeedbackModal
        open={feedback.open}
        onClose={() => setFeedback((previous) => ({ ...previous, open: false }))}
        tone={feedback.tone}
        title={feedback.title}
        message={feedback.message}
        autoCloseMs={feedback.autoCloseMs}
      />
    </AppShell>
  );
}
