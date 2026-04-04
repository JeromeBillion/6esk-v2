DO $$
BEGIN
  CREATE TYPE operator_presence_status AS ENUM ('online', 'away', 'offline');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS voice_operator_presence (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  status operator_presence_status NOT NULL DEFAULT 'offline',
  active_call_session_id uuid REFERENCES call_sessions(id) ON DELETE SET NULL,
  registered_at timestamptz,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_voice_operator_presence_status_last_seen
  ON voice_operator_presence(status, last_seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_voice_operator_presence_active_call
  ON voice_operator_presence(active_call_session_id)
  WHERE active_call_session_id IS NOT NULL;
