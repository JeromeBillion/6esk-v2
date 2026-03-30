CREATE TABLE IF NOT EXISTS call_transcript_ai_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  call_session_id uuid NOT NULL REFERENCES call_sessions(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'managed_http',
  provider_job_id text,
  transcript_r2_key text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  attempt_count integer NOT NULL DEFAULT 0,
  last_error text,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  qa_status text NOT NULL DEFAULT 'unknown',
  summary text,
  resolution_note text,
  qa_flags jsonb NOT NULL DEFAULT '[]'::jsonb,
  action_items jsonb NOT NULL DEFAULT '[]'::jsonb,
  raw_response jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  submitted_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_call_transcript_ai_jobs_call_session
  ON call_transcript_ai_jobs(call_session_id);

CREATE INDEX IF NOT EXISTS idx_call_transcript_ai_jobs_status_next_attempt
  ON call_transcript_ai_jobs(status, next_attempt_at);

CREATE INDEX IF NOT EXISTS idx_call_transcript_ai_jobs_provider_job
  ON call_transcript_ai_jobs(provider, provider_job_id)
  WHERE provider_job_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_call_transcript_ai_jobs_completed_qa
  ON call_transcript_ai_jobs(completed_at, qa_status);
