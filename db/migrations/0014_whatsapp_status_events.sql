CREATE TABLE IF NOT EXISTS whatsapp_status_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid REFERENCES messages(id) ON DELETE SET NULL,
  external_message_id text,
  status text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_status_events_message_id
  ON whatsapp_status_events(message_id);

CREATE INDEX IF NOT EXISTS idx_whatsapp_status_events_external_id
  ON whatsapp_status_events(external_message_id);
