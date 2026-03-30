import { db } from "@/server/db";
import {
  getTranscriptAiProvider,
  type CallTranscriptActionItem,
  type CallTranscriptAiProvider,
  type CallTranscriptQaFlag,
  type CallTranscriptQaStatus
} from "@/server/calls/transcript-ai-provider";

type NumericLike = number | string | null;

export type CallTranscriptAiJobRow = {
  id: string;
  call_session_id: string;
  provider: string;
  provider_job_id: string | null;
  transcript_r2_key: string;
  status: string;
  attempt_count: number;
  last_error: string | null;
  next_attempt_at: Date | null;
  qa_status: CallTranscriptQaStatus | "unknown";
  summary: string | null;
  resolution_note: string | null;
  qa_flags: CallTranscriptQaFlag[];
  action_items: CallTranscriptActionItem[];
  raw_response: Record<string, unknown>;
  metadata: Record<string, unknown>;
  submitted_at: Date | null;
  completed_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

type TranscriptAiJobSummaryRow = {
  queued: NumericLike;
  due_now: NumericLike;
  processing: NumericLike;
  failed: NumericLike;
  completed_24h: NumericLike;
  next_attempt_at: Date | null;
  last_completed_at: Date | null;
  last_failed_at: Date | null;
};

type TranscriptAiAnalysisSummaryRow = {
  analyzed_24h: NumericLike;
  pass_24h: NumericLike;
  watch_24h: NumericLike;
  review_24h: NumericLike;
  flagged_24h: NumericLike;
  total_qa_flags_24h: NumericLike;
  total_action_items_24h: NumericLike;
};

type TranscriptAiErrorRow = {
  last_error: string | null;
};

type TranscriptAiLockRow = {
  id: string;
  call_session_id: string;
  provider: string;
  transcript_r2_key: string;
  metadata: Record<string, unknown>;
  attempt_count: number;
};

type TranscriptAiRecentFlaggedRow = {
  id: string;
  call_session_id: string;
  ticket_id: string;
  message_id: string | null;
  qa_status: string;
  summary: string | null;
  qa_flags: unknown;
  action_items: unknown;
  completed_at: Date | null;
};

type TranscriptAiFailedRow = {
  id: string;
  call_session_id: string;
  status: string;
  attempt_count: number;
  last_error: string | null;
  next_attempt_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

type EnqueueTranscriptAiJobArgs = {
  callSessionId: string;
  transcriptR2Key: string;
  metadata?: Record<string, unknown> | null;
};

type RetryTranscriptAiJobInput = {
  limit?: number;
  jobIds?: string[];
};

function toNumber(value: NumericLike) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toIso(value: Date | null | undefined) {
  return value ? value.toISOString() : null;
}

function parseJsonArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

const DEFAULT_RECOVERY_SECONDS = 300;

function getProcessingRecoverySeconds() {
  const configured = Number(process.env.CALLS_TRANSCRIPT_AI_JOB_RECOVERY_SECONDS ?? "300");
  if (!Number.isFinite(configured) || configured <= 0) {
    return DEFAULT_RECOVERY_SECONDS;
  }
  return Math.floor(configured);
}

export async function enqueueCallTranscriptAiJob({
  callSessionId,
  transcriptR2Key,
  metadata = null
}: EnqueueTranscriptAiJobArgs) {
  const provider = getTranscriptAiProvider();
  const result = await db.query<{
    id: string;
    status: string;
    provider: string;
    transcript_r2_key: string;
  }>(
    `INSERT INTO call_transcript_ai_jobs (
       call_session_id,
       provider,
       transcript_r2_key,
       status,
       next_attempt_at,
       metadata
     ) VALUES ($1, $2, $3, 'queued', now(), $4::jsonb)
     ON CONFLICT (call_session_id)
     DO UPDATE
       SET provider = EXCLUDED.provider,
           transcript_r2_key = EXCLUDED.transcript_r2_key,
           status = CASE
             WHEN call_transcript_ai_jobs.status = 'completed'
                  AND call_transcript_ai_jobs.transcript_r2_key = EXCLUDED.transcript_r2_key
               THEN call_transcript_ai_jobs.status
             ELSE 'queued'
           END,
           next_attempt_at = CASE
             WHEN call_transcript_ai_jobs.status = 'completed'
                  AND call_transcript_ai_jobs.transcript_r2_key = EXCLUDED.transcript_r2_key
               THEN call_transcript_ai_jobs.next_attempt_at
             ELSE now()
           END,
           provider_job_id = CASE
             WHEN call_transcript_ai_jobs.status = 'completed'
                  AND call_transcript_ai_jobs.transcript_r2_key = EXCLUDED.transcript_r2_key
               THEN call_transcript_ai_jobs.provider_job_id
             ELSE NULL
           END,
           last_error = CASE
             WHEN call_transcript_ai_jobs.status = 'completed'
                  AND call_transcript_ai_jobs.transcript_r2_key = EXCLUDED.transcript_r2_key
               THEN call_transcript_ai_jobs.last_error
             ELSE NULL
           END,
           submitted_at = CASE
             WHEN call_transcript_ai_jobs.status = 'completed'
                  AND call_transcript_ai_jobs.transcript_r2_key = EXCLUDED.transcript_r2_key
               THEN call_transcript_ai_jobs.submitted_at
             ELSE NULL
           END,
           completed_at = CASE
             WHEN call_transcript_ai_jobs.status = 'completed'
                  AND call_transcript_ai_jobs.transcript_r2_key = EXCLUDED.transcript_r2_key
               THEN call_transcript_ai_jobs.completed_at
             ELSE NULL
           END,
           qa_status = CASE
             WHEN call_transcript_ai_jobs.status = 'completed'
                  AND call_transcript_ai_jobs.transcript_r2_key = EXCLUDED.transcript_r2_key
               THEN call_transcript_ai_jobs.qa_status
             ELSE 'unknown'
           END,
           summary = CASE
             WHEN call_transcript_ai_jobs.status = 'completed'
                  AND call_transcript_ai_jobs.transcript_r2_key = EXCLUDED.transcript_r2_key
               THEN call_transcript_ai_jobs.summary
             ELSE NULL
           END,
           resolution_note = CASE
             WHEN call_transcript_ai_jobs.status = 'completed'
                  AND call_transcript_ai_jobs.transcript_r2_key = EXCLUDED.transcript_r2_key
               THEN call_transcript_ai_jobs.resolution_note
             ELSE NULL
           END,
           qa_flags = CASE
             WHEN call_transcript_ai_jobs.status = 'completed'
                  AND call_transcript_ai_jobs.transcript_r2_key = EXCLUDED.transcript_r2_key
               THEN call_transcript_ai_jobs.qa_flags
             ELSE '[]'::jsonb
           END,
           action_items = CASE
             WHEN call_transcript_ai_jobs.status = 'completed'
                  AND call_transcript_ai_jobs.transcript_r2_key = EXCLUDED.transcript_r2_key
               THEN call_transcript_ai_jobs.action_items
             ELSE '[]'::jsonb
           END,
           raw_response = CASE
             WHEN call_transcript_ai_jobs.status = 'completed'
                  AND call_transcript_ai_jobs.transcript_r2_key = EXCLUDED.transcript_r2_key
               THEN call_transcript_ai_jobs.raw_response
             ELSE '{}'::jsonb
           END,
           metadata = COALESCE(call_transcript_ai_jobs.metadata, '{}'::jsonb) || EXCLUDED.metadata,
           updated_at = now()
     RETURNING id, status, provider, transcript_r2_key`,
    [callSessionId, provider, transcriptR2Key, JSON.stringify(metadata ?? {})]
  );

  return {
    queued:
      result.rows[0]?.status !== "completed" ||
      result.rows[0]?.transcript_r2_key !== transcriptR2Key,
    jobId: result.rows[0]?.id ?? null,
    provider: (result.rows[0]?.provider as CallTranscriptAiProvider | undefined) ?? provider,
    status: result.rows[0]?.status ?? "queued"
  };
}

async function lockPendingTranscriptAiJobs(limit: number, processingRecoverySeconds: number) {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<TranscriptAiLockRow>(
      `UPDATE call_transcript_ai_jobs
       SET status = 'processing',
           last_error = NULL,
           updated_at = now()
       WHERE id IN (
         SELECT id
         FROM call_transcript_ai_jobs
         WHERE
           (
             (status = 'queued' AND next_attempt_at <= now())
             OR (
               status = 'processing'
               AND updated_at <= now() - make_interval(secs => $2::int)
             )
           )
         ORDER BY created_at ASC
         LIMIT $1
         FOR UPDATE SKIP LOCKED
       )
       RETURNING id, call_session_id, provider, transcript_r2_key, metadata, attempt_count`,
      [limit, processingRecoverySeconds]
    );
    await client.query("COMMIT");
    return result.rows;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function markTranscriptAiJobCompleted({
  jobId,
  attemptCount,
  providerJobId,
  qaStatus,
  summary,
  resolutionNote,
  qaFlags,
  actionItems,
  rawResponse
}: {
  jobId: string;
  attemptCount: number;
  providerJobId?: string | null;
  qaStatus: CallTranscriptQaStatus;
  summary: string;
  resolutionNote: string;
  qaFlags: CallTranscriptQaFlag[];
  actionItems: CallTranscriptActionItem[];
  rawResponse?: Record<string, unknown> | null;
}) {
  await db.query(
    `UPDATE call_transcript_ai_jobs
     SET status = 'completed',
         attempt_count = $2,
         provider_job_id = COALESCE($3, provider_job_id),
         qa_status = $4,
         summary = $5,
         resolution_note = $6,
         qa_flags = $7::jsonb,
         action_items = $8::jsonb,
         raw_response = COALESCE($9::jsonb, '{}'::jsonb),
         submitted_at = COALESCE(submitted_at, now()),
         completed_at = now(),
         updated_at = now()
     WHERE id = $1`,
    [
      jobId,
      attemptCount,
      providerJobId ?? null,
      qaStatus,
      summary,
      resolutionNote,
      JSON.stringify(qaFlags),
      JSON.stringify(actionItems),
      rawResponse ? JSON.stringify(rawResponse) : null
    ]
  );
}

export async function markTranscriptAiJobFailed({
  jobId,
  attemptCount,
  errorMessage
}: {
  jobId: string;
  attemptCount: number;
  errorMessage: string;
}) {
  const nextAttempt = new Date(Date.now() + Math.min(attemptCount, 5) * 60000);
  const status = attemptCount >= 5 ? "failed" : "queued";
  await db.query(
    `UPDATE call_transcript_ai_jobs
     SET status = $2,
         attempt_count = $3,
         last_error = $4,
         next_attempt_at = $5,
         updated_at = now()
     WHERE id = $1`,
    [jobId, status, attemptCount, errorMessage.slice(0, 500), nextAttempt]
  );
}

export async function getTranscriptAiJobMetrics(limit = 8) {
  const provider = getTranscriptAiProvider();
  const normalizedLimit = Math.min(Math.max(limit, 1), 25);

  const [summaryResult, errorResult, analysisResult, recentFlaggedResult] = await Promise.all([
    db.query<TranscriptAiJobSummaryRow>(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'queued')::int AS queued,
         COUNT(*) FILTER (WHERE status = 'queued' AND next_attempt_at <= now())::int AS due_now,
         COUNT(*) FILTER (WHERE status = 'processing')::int AS processing,
         COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
         COUNT(*) FILTER (
           WHERE status = 'completed'
             AND completed_at >= now() - interval '24 hours'
         )::int AS completed_24h,
         MIN(next_attempt_at) FILTER (WHERE status = 'queued') AS next_attempt_at,
         MAX(completed_at) AS last_completed_at,
         MAX(updated_at) FILTER (WHERE status = 'failed') AS last_failed_at
       FROM call_transcript_ai_jobs`
    ),
    db.query<TranscriptAiErrorRow>(
      `SELECT last_error
       FROM call_transcript_ai_jobs
       WHERE status = 'failed'
         AND last_error IS NOT NULL
       ORDER BY updated_at DESC
       LIMIT 1`
    ),
    db.query<TranscriptAiAnalysisSummaryRow>(
      `SELECT
         COUNT(*) FILTER (
           WHERE status = 'completed'
             AND completed_at >= now() - interval '24 hours'
         )::int AS analyzed_24h,
         COUNT(*) FILTER (
           WHERE status = 'completed'
             AND qa_status = 'pass'
             AND completed_at >= now() - interval '24 hours'
         )::int AS pass_24h,
         COUNT(*) FILTER (
           WHERE status = 'completed'
             AND qa_status = 'watch'
             AND completed_at >= now() - interval '24 hours'
         )::int AS watch_24h,
         COUNT(*) FILTER (
           WHERE status = 'completed'
             AND qa_status = 'review'
             AND completed_at >= now() - interval '24 hours'
         )::int AS review_24h,
         COUNT(*) FILTER (
           WHERE status = 'completed'
             AND completed_at >= now() - interval '24 hours'
             AND (
               qa_status IN ('watch', 'review')
               OR jsonb_array_length(qa_flags) > 0
             )
         )::int AS flagged_24h,
         COALESCE(SUM(jsonb_array_length(qa_flags)) FILTER (
           WHERE status = 'completed'
             AND completed_at >= now() - interval '24 hours'
         ), 0)::int AS total_qa_flags_24h,
         COALESCE(SUM(jsonb_array_length(action_items)) FILTER (
           WHERE status = 'completed'
             AND completed_at >= now() - interval '24 hours'
         ), 0)::int AS total_action_items_24h
       FROM call_transcript_ai_jobs`
    ),
    db.query<TranscriptAiRecentFlaggedRow>(
      `SELECT
         job.id,
         job.call_session_id,
         session.ticket_id,
         session.message_id,
         job.qa_status,
         job.summary,
         job.qa_flags,
         job.action_items,
         job.completed_at
       FROM call_transcript_ai_jobs job
       JOIN call_sessions session ON session.id = job.call_session_id
       WHERE job.status = 'completed'
         AND (
           job.qa_status IN ('watch', 'review')
           OR jsonb_array_length(job.qa_flags) > 0
         )
       ORDER BY job.completed_at DESC NULLS LAST
       LIMIT $1`,
      [normalizedLimit]
    )
  ]);

  const summary = summaryResult.rows[0] ?? {
    queued: 0,
    due_now: 0,
    processing: 0,
    failed: 0,
    completed_24h: 0,
    next_attempt_at: null,
    last_completed_at: null,
    last_failed_at: null
  };
  const analysis = analysisResult.rows[0] ?? {
    analyzed_24h: 0,
    pass_24h: 0,
    watch_24h: 0,
    review_24h: 0,
    flagged_24h: 0,
    total_qa_flags_24h: 0,
    total_action_items_24h: 0
  };

  return {
    provider,
    queue: {
      queued: toNumber(summary.queued),
      dueNow: toNumber(summary.due_now),
      processing: toNumber(summary.processing),
      failed: toNumber(summary.failed),
      completed24h: toNumber(summary.completed_24h),
      nextAttemptAt: toIso(summary.next_attempt_at),
      lastCompletedAt: toIso(summary.last_completed_at),
      lastFailedAt: toIso(summary.last_failed_at),
      lastError: errorResult.rows[0]?.last_error ?? null
    },
    analysis: {
      analyzed24h: toNumber(analysis.analyzed_24h),
      pass24h: toNumber(analysis.pass_24h),
      watch24h: toNumber(analysis.watch_24h),
      review24h: toNumber(analysis.review_24h),
      flagged24h: toNumber(analysis.flagged_24h),
      totalQaFlags24h: toNumber(analysis.total_qa_flags_24h),
      totalActionItems24h: toNumber(analysis.total_action_items_24h)
    },
    recentFlagged: recentFlaggedResult.rows.map((row) => ({
      jobId: row.id,
      callSessionId: row.call_session_id,
      ticketId: row.ticket_id,
      messageId: row.message_id,
      qaStatus: row.qa_status,
      summary: row.summary,
      qaFlags: parseJsonArray<CallTranscriptQaFlag>(row.qa_flags),
      actionItems: parseJsonArray<CallTranscriptActionItem>(row.action_items),
      completedAt: toIso(row.completed_at)
    }))
  };
}

export async function listFailedTranscriptAiJobs(limit = 30) {
  const normalizedLimit = Math.min(Math.max(limit, 1), 100);
  const result = await db.query<TranscriptAiFailedRow>(
    `SELECT
       id,
       call_session_id,
       status,
       attempt_count,
       last_error,
       next_attempt_at,
       created_at,
       updated_at
     FROM call_transcript_ai_jobs
     WHERE status = 'failed'
     ORDER BY updated_at DESC
     LIMIT $1`,
    [normalizedLimit]
  );

  return result.rows.map((row) => ({
    id: row.id,
    callSessionId: row.call_session_id,
    status: row.status,
    attemptCount: row.attempt_count,
    lastError: row.last_error,
    nextAttemptAt: toIso(row.next_attempt_at),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  }));
}

export async function retryFailedTranscriptAiJobs(input: RetryTranscriptAiJobInput = {}) {
  const normalizedLimit = Math.min(Math.max(input.limit ?? 25, 1), 100);
  const jobIds = Array.from(
    new Set((input.jobIds ?? []).map((value) => value.trim()).filter(Boolean))
  ).slice(0, 100);
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const result =
      jobIds.length > 0
        ? await client.query<{ id: string }>(
            `UPDATE call_transcript_ai_jobs
             SET status = 'queued',
                 next_attempt_at = now(),
                 updated_at = now()
             WHERE status = 'failed'
               AND id::text = ANY($1::text[])
             RETURNING id`,
            [jobIds]
          )
        : await client.query<{ id: string }>(
            `WITH failed AS (
               SELECT id
               FROM call_transcript_ai_jobs
               WHERE status = 'failed'
               ORDER BY updated_at ASC
               LIMIT $1
               FOR UPDATE SKIP LOCKED
             )
             UPDATE call_transcript_ai_jobs job
             SET status = 'queued',
                 next_attempt_at = now(),
                 updated_at = now()
             FROM failed
             WHERE job.id = failed.id
             RETURNING job.id`,
            [normalizedLimit]
          );
    await client.query("COMMIT");
    return {
      requested: jobIds.length > 0 ? jobIds.length : normalizedLimit,
      retried: result.rows.length,
      ids: result.rows.map((row) => row.id)
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export { lockPendingTranscriptAiJobs, getProcessingRecoverySeconds };
