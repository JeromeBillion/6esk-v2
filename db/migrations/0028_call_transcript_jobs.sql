CREATE TABLE IF NOT EXISTS call_transcript_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  call_session_id uuid NOT NULL REFERENCES call_sessions(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'managed_http',
  provider_job_id text,
  recording_r2_key text NOT NULL,
  transcript_r2_key text,
  status text NOT NULL DEFAULT 'queued',
  attempt_count integer NOT NULL DEFAULT 0,
  last_error text,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  submitted_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_call_transcript_jobs_call_session
  ON call_transcript_jobs(call_session_id);

CREATE INDEX IF NOT EXISTS idx_call_transcript_jobs_status_next_attempt
  ON call_transcript_jobs(status, next_attempt_at);

CREATE INDEX IF NOT EXISTS idx_call_transcript_jobs_provider_job
  ON call_transcript_jobs(provider, provider_job_id)
  WHERE provider_job_id IS NOT NULL;
