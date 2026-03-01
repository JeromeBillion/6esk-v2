ALTER TABLE call_sessions
  ADD COLUMN IF NOT EXISTS event_sequence integer NOT NULL DEFAULT 0;

WITH event_counts AS (
  SELECT call_session_id, COUNT(*)::int AS event_count
  FROM call_events
  GROUP BY call_session_id
)
UPDATE call_sessions session
SET event_sequence = GREATEST(session.event_sequence, event_counts.event_count),
    updated_at = now()
FROM event_counts
WHERE session.id = event_counts.call_session_id;

CREATE TABLE IF NOT EXISTS call_review_writebacks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  call_session_id uuid NOT NULL REFERENCES call_sessions(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL,
  source text NOT NULL DEFAULT 'request_human_review',
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_call_review_writebacks_session_idempotency
  ON call_review_writebacks(call_session_id, idempotency_key);

CREATE INDEX IF NOT EXISTS idx_call_review_writebacks_ticket_created
  ON call_review_writebacks(ticket_id, created_at DESC);
