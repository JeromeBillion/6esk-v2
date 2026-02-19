import { LEAD_ADMIN_ROLE } from "@/server/auth/roles";
import type { SessionUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { MergeError, mergeCustomers, mergeTickets } from "@/server/merges";

export type MergeReviewStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "applied"
  | "failed";
export type MergeReviewProposalType = "ticket" | "customer";

export type MergeReviewTask = {
  id: string;
  status: MergeReviewStatus;
  proposal_type: MergeReviewProposalType;
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
};

export type MergeReviewQueueItem = MergeReviewTask & {
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

export type MergeReviewDecision = "approve" | "reject";

type CreateMergeReviewTaskArgs = {
  proposalType: MergeReviewProposalType;
  ticketId?: string | null;
  sourceTicketId?: string | null;
  targetTicketId?: string | null;
  sourceCustomerId?: string | null;
  targetCustomerId?: string | null;
  reason?: string | null;
  confidence?: number | null;
  metadata?: Record<string, unknown> | null;
  proposedByAgentId?: string | null;
  proposedByUserId?: string | null;
};

type ListMergeReviewTasksFilters = {
  status?: MergeReviewStatus | "all" | null;
  search?: string | null;
  limit?: number;
  assignedUserId?: string | null;
};

type ResolveMergeReviewTaskArgs = {
  reviewId: string;
  decision: MergeReviewDecision;
  actorUserId: string;
  note?: string | null;
};

type MergeReviewOperationResult = {
  task: MergeReviewTask;
  mergeResult: Record<string, unknown> | null;
};

type MergeReviewErrorCode =
  | "not_found"
  | "forbidden"
  | "not_pending"
  | "invalid_input"
  | "merge_failed";

export class MergeReviewError extends Error {
  code: MergeReviewErrorCode;

  constructor(code: MergeReviewErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

function isLeadAdmin(user: SessionUser) {
  return user.role_name === LEAD_ADMIN_ROLE;
}

async function fetchTaskById(reviewId: string) {
  const result = await db.query<MergeReviewTask>(
    `SELECT
       id,
       status,
       proposal_type,
       ticket_id,
       source_ticket_id,
       target_ticket_id,
       source_customer_id,
       target_customer_id,
       reason,
       confidence,
       metadata,
       failure_reason,
       proposed_by_agent_id,
       proposed_by_user_id,
       reviewed_by_user_id,
       reviewed_at,
       applied_at,
       created_at,
       updated_at
     FROM merge_review_tasks
     WHERE id = $1
     LIMIT 1`,
    [reviewId]
  );
  return result.rows[0] ?? null;
}

async function userCanAccessTask(user: SessionUser, task: MergeReviewTask) {
  if (isLeadAdmin(user)) return true;
  const candidateTicketIds = [
    task.ticket_id,
    task.source_ticket_id,
    task.target_ticket_id
  ].filter((value): value is string => Boolean(value));
  if (!candidateTicketIds.length) return false;

  const result = await db.query(
    `SELECT 1
     FROM tickets
     WHERE id = ANY($1::uuid[])
       AND assigned_user_id = $2
     LIMIT 1`,
    [candidateTicketIds, user.id]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function getMergeReviewTaskForUser(
  user: SessionUser,
  reviewId: string
) {
  const task = await fetchTaskById(reviewId);
  if (!task) return null;
  if (!(await userCanAccessTask(user, task))) {
    return null;
  }
  return task;
}

export async function createMergeReviewTask({
  proposalType,
  ticketId,
  sourceTicketId,
  targetTicketId,
  sourceCustomerId,
  targetCustomerId,
  reason,
  confidence,
  metadata,
  proposedByAgentId,
  proposedByUserId
}: CreateMergeReviewTaskArgs) {
  if (proposalType === "ticket" && (!sourceTicketId || !targetTicketId)) {
    throw new MergeReviewError(
      "invalid_input",
      "Ticket merge review requires source and target ticket ids."
    );
  }
  if (proposalType === "customer" && (!sourceCustomerId || !targetCustomerId)) {
    throw new MergeReviewError(
      "invalid_input",
      "Customer merge review requires source and target customer ids."
    );
  }

  const result = await db.query<MergeReviewTask>(
    `INSERT INTO merge_review_tasks (
      proposal_type,
      ticket_id,
      source_ticket_id,
      target_ticket_id,
      source_customer_id,
      target_customer_id,
      reason,
      confidence,
      metadata,
      proposed_by_agent_id,
      proposed_by_user_id
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11
    )
    RETURNING
      id,
      status,
      proposal_type,
      ticket_id,
      source_ticket_id,
      target_ticket_id,
      source_customer_id,
      target_customer_id,
      reason,
      confidence,
      metadata,
      failure_reason,
      proposed_by_agent_id,
      proposed_by_user_id,
      reviewed_by_user_id,
      reviewed_at,
      applied_at,
      created_at,
      updated_at`,
    [
      proposalType,
      ticketId ?? null,
      sourceTicketId ?? null,
      targetTicketId ?? null,
      sourceCustomerId ?? null,
      targetCustomerId ?? null,
      reason ?? null,
      confidence ?? null,
      metadata ?? null,
      proposedByAgentId ?? null,
      proposedByUserId ?? null
    ]
  );

  return result.rows[0];
}

export async function listMergeReviewTasksForUser(
  user: SessionUser,
  filters: ListMergeReviewTasksFilters = {}
) {
  const values: Array<string | number> = [];
  const conditions: string[] = [];
  const isAdmin = isLeadAdmin(user);

  if (!isAdmin) {
    values.push(user.id);
    conditions.push(
      `EXISTS (
        SELECT 1
        FROM tickets access_t
        WHERE access_t.assigned_user_id = $${values.length}
          AND access_t.id = ANY(
            array_remove(ARRAY[mrt.ticket_id, mrt.source_ticket_id, mrt.target_ticket_id], NULL)::uuid[]
          )
      )`
    );
  } else if (filters.assignedUserId) {
    values.push(filters.assignedUserId);
    conditions.push(
      `EXISTS (
        SELECT 1
        FROM tickets access_t
        WHERE access_t.assigned_user_id = $${values.length}
          AND access_t.id = ANY(
            array_remove(ARRAY[mrt.ticket_id, mrt.source_ticket_id, mrt.target_ticket_id], NULL)::uuid[]
          )
      )`
    );
  }

  if (filters.status && filters.status !== "all") {
    values.push(filters.status);
    conditions.push(`mrt.status = $${values.length}`);
  }

  if (filters.search) {
    values.push(`%${filters.search}%`);
    const q = `$${values.length}`;
    conditions.push(
      `(
        mrt.id::text ILIKE ${q}
        OR COALESCE(mrt.reason, '') ILIKE ${q}
        OR COALESCE(context_ticket.subject, '') ILIKE ${q}
        OR COALESCE(source_ticket.subject, '') ILIKE ${q}
        OR COALESCE(target_ticket.subject, '') ILIKE ${q}
        OR COALESCE(source_ticket.requester_email, '') ILIKE ${q}
        OR COALESCE(target_ticket.requester_email, '') ILIKE ${q}
        OR COALESCE(source_customer.display_name, '') ILIKE ${q}
        OR COALESCE(target_customer.display_name, '') ILIKE ${q}
        OR COALESCE(source_customer.primary_email, '') ILIKE ${q}
        OR COALESCE(target_customer.primary_email, '') ILIKE ${q}
        OR COALESCE(source_customer.primary_phone, '') ILIKE ${q}
        OR COALESCE(target_customer.primary_phone, '') ILIKE ${q}
      )`
    );
  }

  const limit = Math.min(Math.max(filters.limit ?? 100, 1), 200);
  values.push(limit);

  const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const result = await db.query<MergeReviewQueueItem>(
    `SELECT
       mrt.id,
       mrt.status,
       mrt.proposal_type,
       mrt.ticket_id,
       mrt.source_ticket_id,
       mrt.target_ticket_id,
       mrt.source_customer_id,
       mrt.target_customer_id,
       mrt.reason,
       mrt.confidence,
       mrt.metadata,
       mrt.failure_reason,
       mrt.proposed_by_agent_id,
       mrt.proposed_by_user_id,
       mrt.reviewed_by_user_id,
       mrt.reviewed_at,
       mrt.applied_at,
       mrt.created_at,
       mrt.updated_at,
       context_ticket.subject AS context_ticket_subject,
       context_ticket.requester_email AS context_ticket_requester_email,
       source_ticket.subject AS source_ticket_subject,
       source_ticket.requester_email AS source_ticket_requester_email,
       EXISTS (
         SELECT 1 FROM messages source_msg
         WHERE source_msg.ticket_id = source_ticket.id
           AND source_msg.channel = 'whatsapp'
       ) OR COALESCE(source_ticket.requester_email ILIKE 'whatsapp:%', FALSE) AS source_ticket_has_whatsapp,
       EXISTS (
         SELECT 1 FROM messages source_msg
         WHERE source_msg.ticket_id = source_ticket.id
           AND source_msg.channel = 'voice'
       ) OR COALESCE(source_ticket.requester_email ILIKE 'voice:%', FALSE) AS source_ticket_has_voice,
       target_ticket.subject AS target_ticket_subject,
       target_ticket.requester_email AS target_ticket_requester_email,
       EXISTS (
         SELECT 1 FROM messages target_msg
         WHERE target_msg.ticket_id = target_ticket.id
           AND target_msg.channel = 'whatsapp'
       ) OR COALESCE(target_ticket.requester_email ILIKE 'whatsapp:%', FALSE) AS target_ticket_has_whatsapp,
       EXISTS (
         SELECT 1 FROM messages target_msg
         WHERE target_msg.ticket_id = target_ticket.id
           AND target_msg.channel = 'voice'
       ) OR COALESCE(target_ticket.requester_email ILIKE 'voice:%', FALSE) AS target_ticket_has_voice,
       source_customer.display_name AS source_customer_display_name,
       source_customer.primary_email AS source_customer_primary_email,
       source_customer.primary_phone AS source_customer_primary_phone,
       target_customer.display_name AS target_customer_display_name,
       target_customer.primary_email AS target_customer_primary_email,
       target_customer.primary_phone AS target_customer_primary_phone
     FROM merge_review_tasks mrt
     LEFT JOIN tickets context_ticket ON context_ticket.id = mrt.ticket_id
     LEFT JOIN tickets source_ticket ON source_ticket.id = mrt.source_ticket_id
     LEFT JOIN tickets target_ticket ON target_ticket.id = mrt.target_ticket_id
     LEFT JOIN customers source_customer ON source_customer.id = mrt.source_customer_id
     LEFT JOIN customers target_customer ON target_customer.id = mrt.target_customer_id
     ${whereClause}
     ORDER BY
       CASE mrt.status
         WHEN 'pending' THEN 0
         WHEN 'approved' THEN 1
         WHEN 'failed' THEN 2
         WHEN 'rejected' THEN 3
         WHEN 'applied' THEN 4
         ELSE 5
       END,
       mrt.created_at DESC
     LIMIT $${values.length}`,
    values
  );
  return result.rows;
}

export async function resolveMergeReviewTask({
  reviewId,
  decision,
  actorUserId,
  note
}: ResolveMergeReviewTaskArgs): Promise<MergeReviewOperationResult> {
  const existing = await fetchTaskById(reviewId);
  if (!existing) {
    throw new MergeReviewError("not_found", "Merge review task not found.");
  }
  if (existing.status !== "pending") {
    throw new MergeReviewError("not_pending", "Merge review task is no longer pending.");
  }

  if (decision === "reject") {
    const rejected = await db.query<MergeReviewTask>(
      `UPDATE merge_review_tasks
       SET status = 'rejected',
           reviewed_by_user_id = $2,
           reviewed_at = now(),
           failure_reason = $3,
           updated_at = now()
       WHERE id = $1
         AND status = 'pending'
       RETURNING
         id,
         status,
         proposal_type,
         ticket_id,
         source_ticket_id,
         target_ticket_id,
         source_customer_id,
         target_customer_id,
         reason,
         confidence,
         metadata,
         failure_reason,
         proposed_by_agent_id,
         proposed_by_user_id,
         reviewed_by_user_id,
         reviewed_at,
         applied_at,
         created_at,
         updated_at`,
      [reviewId, actorUserId, note ?? null]
    );

    const task = rejected.rows[0];
    if (!task) {
      throw new MergeReviewError("not_pending", "Merge review task is no longer pending.");
    }
    return { task, mergeResult: null };
  }

  const approved = await db.query<MergeReviewTask>(
    `UPDATE merge_review_tasks
     SET status = 'approved',
         reviewed_by_user_id = $2,
         reviewed_at = now(),
         updated_at = now()
     WHERE id = $1
       AND status = 'pending'
     RETURNING
       id,
       status,
       proposal_type,
       ticket_id,
       source_ticket_id,
       target_ticket_id,
       source_customer_id,
       target_customer_id,
       reason,
       confidence,
       metadata,
       failure_reason,
       proposed_by_agent_id,
       proposed_by_user_id,
       reviewed_by_user_id,
       reviewed_at,
       applied_at,
       created_at,
       updated_at`,
    [reviewId, actorUserId]
  );

  const approvedTask = approved.rows[0];
  if (!approvedTask) {
    throw new MergeReviewError("not_pending", "Merge review task is no longer pending.");
  }

  try {
    let mergeResult: Record<string, unknown>;
    if (approvedTask.proposal_type === "ticket") {
      if (!approvedTask.source_ticket_id || !approvedTask.target_ticket_id) {
        throw new MergeReviewError("invalid_input", "Ticket merge review task is incomplete.");
      }
      mergeResult = await mergeTickets({
        sourceTicketId: approvedTask.source_ticket_id,
        targetTicketId: approvedTask.target_ticket_id,
        actorUserId,
        reason: note ?? approvedTask.reason ?? null
      });
    } else {
      if (!approvedTask.source_customer_id || !approvedTask.target_customer_id) {
        throw new MergeReviewError("invalid_input", "Customer merge review task is incomplete.");
      }
      mergeResult = await mergeCustomers({
        sourceCustomerId: approvedTask.source_customer_id,
        targetCustomerId: approvedTask.target_customer_id,
        actorUserId,
        reason: note ?? approvedTask.reason ?? null
      });
    }

    const applied = await db.query<MergeReviewTask>(
      `UPDATE merge_review_tasks
       SET status = 'applied',
           applied_at = now(),
           updated_at = now(),
           failure_reason = NULL
       WHERE id = $1
       RETURNING
         id,
         status,
         proposal_type,
         ticket_id,
         source_ticket_id,
         target_ticket_id,
         source_customer_id,
         target_customer_id,
         reason,
         confidence,
         metadata,
         failure_reason,
         proposed_by_agent_id,
         proposed_by_user_id,
         reviewed_by_user_id,
         reviewed_at,
         applied_at,
         created_at,
         updated_at`,
      [reviewId]
    );
    return { task: applied.rows[0] ?? approvedTask, mergeResult };
  } catch (error) {
    const detail =
      error instanceof MergeReviewError
        ? error.message
        : error instanceof MergeError
          ? error.message
          : error instanceof Error
            ? error.message
            : "Failed to apply merge review task.";
    await db.query(
      `UPDATE merge_review_tasks
       SET status = 'failed',
           failure_reason = $2,
           updated_at = now()
       WHERE id = $1`,
      [reviewId, detail]
    );
    throw new MergeReviewError("merge_failed", detail);
  }
}
