DO $$
BEGIN
  ALTER TYPE message_channel ADD VALUE IF NOT EXISTS 'voice';
EXCEPTION
  WHEN undefined_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE call_direction AS ENUM ('inbound', 'outbound');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE call_status AS ENUM (
    'queued',
    'dialing',
    'ringing',
    'in_progress',
    'completed',
    'no_answer',
    'busy',
    'failed',
    'canceled'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE call_created_by AS ENUM ('human', 'ai', 'system');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS call_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL DEFAULT 'pending',
  provider_call_id text,
  ticket_id uuid NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  mailbox_id uuid REFERENCES mailboxes(id) ON DELETE SET NULL,
  message_id uuid REFERENCES messages(id) ON DELETE SET NULL,
  direction call_direction NOT NULL,
  status call_status NOT NULL DEFAULT 'queued',
  from_phone text,
  to_phone text NOT NULL,
  queued_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  ended_at timestamptz,
  duration_seconds integer,
  recording_url text,
  recording_r2_key text,
  transcript_r2_key text,
  idempotency_key text,
  created_by call_created_by NOT NULL DEFAULT 'system',
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_by_integration_id uuid REFERENCES agent_integrations(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_call_sessions_provider_call_id
  ON call_sessions(provider, provider_call_id)
  WHERE provider_call_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_call_sessions_ticket_id
  ON call_sessions(ticket_id);

CREATE INDEX IF NOT EXISTS idx_call_sessions_status
  ON call_sessions(status);

CREATE UNIQUE INDEX IF NOT EXISTS uq_call_sessions_ticket_direction_idempotency
  ON call_sessions(ticket_id, direction, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS call_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  call_session_id uuid NOT NULL REFERENCES call_sessions(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_call_events_session_id
  ON call_events(call_session_id);

CREATE INDEX IF NOT EXISTS idx_call_events_occurred_at
  ON call_events(occurred_at DESC);

CREATE TABLE IF NOT EXISTS call_outbox_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  direction call_direction NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  attempt_count integer NOT NULL DEFAULT 0,
  last_error text,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_call_outbox_events_status_next_attempt
  ON call_outbox_events(status, next_attempt_at);
