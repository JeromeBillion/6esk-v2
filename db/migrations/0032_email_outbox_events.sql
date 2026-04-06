CREATE TABLE email_outbox_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  direction text NOT NULL DEFAULT 'outbound',
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  attempt_count integer NOT NULL DEFAULT 0,
  last_error text,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_email_outbox_events_status ON email_outbox_events(status, next_attempt_at);
CREATE INDEX idx_email_outbox_events_created_at ON email_outbox_events(created_at);
