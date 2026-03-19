import { apiFetch } from "@/app/lib/api/http";

export type MergeReviewStatus = "pending" | "approved" | "rejected" | "applied" | "failed" | "all";

export type MergeReviewQueueItem = {
  id: string;
  status: Exclude<MergeReviewStatus, "all">;
  proposal_type: "ticket" | "customer";
  ticket_id: string | null;
  source_ticket_id: string | null;
  target_ticket_id: string | null;
  source_customer_id: string | null;
  target_customer_id: string | null;
  reason: string | null;
  confidence: number | null;
  metadata: Record<string, unknown> | null;
  failure_reason: string | null;
  proposed_by_agent_id: string | null;
  proposed_by_user_id: string | null;
  reviewed_by_user_id: string | null;
  reviewed_at: string | null;
  applied_at: string | null;
  created_at: string;
  updated_at: string;
  context_ticket_subject: string | null;
  context_ticket_requester_email: string | null;
  source_ticket_subject: string | null;
  source_ticket_requester_email: string | null;
  source_ticket_has_whatsapp: boolean;
  source_ticket_has_voice: boolean;
  target_ticket_subject: string | null;
  target_ticket_requester_email: string | null;
  target_ticket_has_whatsapp: boolean;
  target_ticket_has_voice: boolean;
  source_customer_display_name: string | null;
  source_customer_primary_email: string | null;
  source_customer_primary_phone: string | null;
  target_customer_display_name: string | null;
  target_customer_primary_email: string | null;
  target_customer_primary_phone: string | null;
};

export function listMergeReviews(input?: {
  status?: MergeReviewStatus;
  query?: string;
  assigned?: "mine";
  limit?: number;
  signal?: AbortSignal;
}) {
  const params = new URLSearchParams();
  params.set("status", input?.status ?? "pending");
  if (input?.query?.trim()) {
    params.set("q", input.query.trim());
  }
  if (input?.assigned === "mine") {
    params.set("assigned", "mine");
  }
  if (input?.limit) {
    params.set("limit", String(input.limit));
  }
  return apiFetch<{ reviews: MergeReviewQueueItem[] }>(
    `/api/merge-reviews?${params.toString()}`,
    { signal: input?.signal }
  ).then((payload) => payload.reviews ?? []);
}

export function resolveMergeReview(
  reviewId: string,
  input: { decision: "approve" | "reject"; note?: string | null }
) {
  return apiFetch<{
    status: string;
    task: MergeReviewQueueItem;
    mergeResult: Record<string, unknown> | null;
  }>(`/api/merge-reviews/${reviewId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
}
