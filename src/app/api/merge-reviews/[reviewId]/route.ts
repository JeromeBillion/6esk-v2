import { z } from "zod";
import { getSessionUser } from "@/server/auth/session";
import { canManageTickets } from "@/server/auth/roles";
import { recordAuditLog } from "@/server/audit";
import { recordTicketEvent } from "@/server/tickets";
import {
  getMergeReviewTaskForUser,
  MergeReviewError,
  resolveMergeReviewTask
} from "@/server/merge-reviews";

const decisionSchema = z.object({
  decision: z.enum(["approve", "reject"]),
  note: z.string().max(500).optional().nullable()
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ reviewId: string }> }
) {
  const user = await getSessionUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!canManageTickets(user)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch (error) {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = decisionSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json({ error: "Invalid payload" }, { status: 400 });
  }

  const { reviewId } = await params;
  const task = await getMergeReviewTaskForUser(user, reviewId);
  if (!task) {
    return Response.json({ error: "Merge review task not found" }, { status: 404 });
  }

  try {
    const result = await resolveMergeReviewTask({
      reviewId,
      decision: parsed.data.decision,
      actorUserId: user.id,
      note: parsed.data.note ?? null
    });

    const actionName =
      parsed.data.decision === "approve"
        ? "merge_review_approved"
        : "merge_review_rejected";

    await recordAuditLog({
      actorUserId: user.id,
      action: actionName,
      entityType: "merge_review_task",
      entityId: reviewId,
      data: {
        decision: parsed.data.decision,
        note: parsed.data.note ?? null,
        reviewTaskId: reviewId,
        proposalType: task.proposal_type,
        mergeResult: result.mergeResult
      }
    });

    if (task.ticket_id) {
      await recordTicketEvent({
        ticketId: task.ticket_id,
        eventType:
          parsed.data.decision === "approve"
            ? "merge_review_applied"
            : "merge_review_rejected",
        actorUserId: user.id,
        data: {
          reviewTaskId: reviewId,
          proposalType: task.proposal_type,
          note: parsed.data.note ?? null
        }
      });
    }

    return Response.json({
      status: "ok",
      task: result.task,
      mergeResult: result.mergeResult
    });
  } catch (error) {
    if (error instanceof MergeReviewError) {
      const status =
        error.code === "not_found"
          ? 404
          : error.code === "forbidden"
            ? 403
            : error.code === "invalid_input"
              ? 400
              : error.code === "not_pending"
                ? 409
                : 409;
      return Response.json({ error: error.message, code: error.code }, { status });
    }

    const message =
      error instanceof Error ? error.message : "Failed to resolve merge review task";
    return Response.json({ error: message }, { status: 500 });
  }
}
