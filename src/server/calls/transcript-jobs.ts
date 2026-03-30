import { db } from "@/server/db";
import { getTranscriptProvider, type CallTranscriptProvider } from "@/server/calls/stt-provider";

type NumericLike = number | string | null;

export type CallTranscriptJobRow = {
  id: string;
  call_session_id: string;
  provider: string;
  provider_job_id: string | null;
  recording_r2_key: string;
  transcript_r2_key: string | null;
  status: string;
  attempt_count: number;
  last_error: string | null;
  next_attempt_at: Date | null;
  metadata: Record<string, unknown>;
  submitted_at: Date | null;
  completed_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

type TranscriptJobSummaryRow = {
  queued: NumericLike;
  due_now: NumericLike;
  processing: NumericLike;
  submitted: NumericLike;
  failed: NumericLike;
  completed_24h: NumericLike;
  next_attempt_at: Date | null;
  last_submitted_at: Date | null;
  last_completed_at: Date | null;
  last_failed_at: Date | null;
};

type TranscriptJobErrorRow = {
  last_error: string | null;
};

type TranscriptJobLockRow = {
  id: string;
  call_session_id: string;
  provider: string;
  recording_r2_key: string;
  metadata: Record<string, unknown>;
  attempt_count: number;
};

type EnqueueTranscriptJobArgs = {
  callSessionId: string;
  recordingR2Key: string;
  metadata?: Record<string, unknown> | null;
};

type RetryTranscriptJobInput = {
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

const DEFAULT_RECOVERY_SECONDS = 300;

function getProcessingRecoverySeconds() {
  const configured = Number(process.env.CALLS_TRANSCRIPT_JOB_RECOVERY_SECONDS ?? "300");
  if (!Number.isFinite(configured) || configured <= 0) {
    return DEFAULT_RECOVERY_SECONDS;
  }
  return Math.floor(configured);
}

export async function enqueueCallTranscriptJob({
  callSessionId,
  recordingR2Key,
  metadata = null
}: EnqueueTranscriptJobArgs) {
  const provider = getTranscriptProvider();
  const result = await db.query<{
    id: string;
    status: string;
    provider: string;
  }>(
    `INSERT INTO call_transcript_jobs (
       call_session_id,
       provider,
       recording_r2_key,
       status,
       next_attempt_at,
       metadata
     ) VALUES ($1, $2, $3, 'queued', now(), $4::jsonb)
     ON CONFLICT (call_session_id)
     DO UPDATE
       SET provider = EXCLUDED.provider,
           recording_r2_key = EXCLUDED.recording_r2_key,
           status = CASE
             WHEN call_transcript_jobs.status = 'completed' THEN call_transcript_jobs.status
             ELSE 'queued'
           END,
           next_attempt_at = CASE
             WHEN call_transcript_jobs.status = 'completed' THEN call_transcript_jobs.next_attempt_at
             ELSE now()
           END,
           last_error = CASE
             WHEN call_transcript_jobs.status = 'completed' THEN call_transcript_jobs.last_error
             ELSE NULL
           END,
           metadata = COALESCE(call_transcript_jobs.metadata, '{}'::jsonb) || EXCLUDED.metadata,
           updated_at = now()
     RETURNING id, status, provider`,
    [callSessionId, provider, recordingR2Key, JSON.stringify(metadata ?? {})]
  );

  return {
    queued: result.rows[0]?.status !== "completed",
    jobId: result.rows[0]?.id ?? null,
    provider: (result.rows[0]?.provider as CallTranscriptProvider | undefined) ?? provider,
    status: result.rows[0]?.status ?? "queued"
  };
}

export async function markTranscriptJobCompleted({
  callSessionId,
  transcriptR2Key
}: {
  callSessionId: string;
  transcriptR2Key?: string | null;
}) {
  await db.query(
    `UPDATE call_transcript_jobs
     SET status = 'completed',
         transcript_r2_key = COALESCE($2, transcript_r2_key),
         completed_at = now(),
         updated_at = now()
     WHERE call_session_id = $1`,
    [callSessionId, transcriptR2Key ?? null]
  );
}

async function lockPendingTranscriptJobs(limit: number, processingRecoverySeconds: number) {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<TranscriptJobLockRow>(
      `UPDATE call_transcript_jobs
       SET status = 'processing',
           last_error = NULL,
           updated_at = now()
       WHERE id IN (
         SELECT id
         FROM call_transcript_jobs
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
       RETURNING id, call_session_id, provider, recording_r2_key, metadata, attempt_count`,
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

export async function markTranscriptJobSubmitted({
  jobId,
  attemptCount,
  providerJobId
}: {
  jobId: string;
  attemptCount: number;
  providerJobId?: string | null;
}) {
  await db.query(
    `UPDATE call_transcript_jobs
     SET status = 'submitted',
         attempt_count = $2,
         provider_job_id = COALESCE($3, provider_job_id),
         submitted_at = now(),
         updated_at = now()
     WHERE id = $1`,
    [jobId, attemptCount, providerJobId ?? null]
  );
}

export async function markTranscriptJobFailed({
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
    `UPDATE call_transcript_jobs
     SET status = $2,
         attempt_count = $3,
         last_error = $4,
         next_attempt_at = $5,
         updated_at = now()
     WHERE id = $1`,
    [jobId, status, attemptCount, errorMessage.slice(0, 500), nextAttempt]
  );
}

export async function getTranscriptJobMetrics() {
  const provider = getTranscriptProvider();
  const summaryResult = await db.query<TranscriptJobSummaryRow>(
    `SELECT
       COUNT(*) FILTER (WHERE status = 'queued')::int AS queued,
       COUNT(*) FILTER (WHERE status = 'queued' AND next_attempt_at <= now())::int AS due_now,
       COUNT(*) FILTER (WHERE status = 'processing')::int AS processing,
       COUNT(*) FILTER (WHERE status = 'submitted')::int AS submitted,
       COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
       COUNT(*) FILTER (
         WHERE status = 'completed'
           AND completed_at >= now() - interval '24 hours'
       )::int AS completed_24h,
       MIN(next_attempt_at) FILTER (WHERE status = 'queued') AS next_attempt_at,
       MAX(submitted_at) AS last_submitted_at,
       MAX(completed_at) AS last_completed_at,
       MAX(updated_at) FILTER (WHERE status = 'failed') AS last_failed_at
     FROM call_transcript_jobs`
  );

  const errorResult = await db.query<TranscriptJobErrorRow>(
    `SELECT last_error
     FROM call_transcript_jobs
     WHERE status = 'failed'
       AND last_error IS NOT NULL
     ORDER BY updated_at DESC
     LIMIT 1`
  );

  const summary = summaryResult.rows[0] ?? {
    queued: 0,
    due_now: 0,
    processing: 0,
    submitted: 0,
    failed: 0,
    completed_24h: 0,
    next_attempt_at: null,
    last_submitted_at: null,
    last_completed_at: null,
    last_failed_at: null
  };

  return {
    provider,
    queue: {
      queued: toNumber(summary.queued),
      dueNow: toNumber(summary.due_now),
      processing: toNumber(summary.processing),
      submitted: toNumber(summary.submitted),
      failed: toNumber(summary.failed),
      completed24h: toNumber(summary.completed_24h),
      nextAttemptAt: toIso(summary.next_attempt_at),
      lastSubmittedAt: toIso(summary.last_submitted_at),
      lastCompletedAt: toIso(summary.last_completed_at),
      lastFailedAt: toIso(summary.last_failed_at),
      lastError: errorResult.rows[0]?.last_error ?? null
    }
  };
}

export async function retryFailedTranscriptJobs(input: RetryTranscriptJobInput = {}) {
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
            `UPDATE call_transcript_jobs
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
               FROM call_transcript_jobs
               WHERE status = 'failed'
               ORDER BY updated_at ASC
               LIMIT $1
               FOR UPDATE SKIP LOCKED
             )
             UPDATE call_transcript_jobs job
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

export { lockPendingTranscriptJobs, getProcessingRecoverySeconds };
