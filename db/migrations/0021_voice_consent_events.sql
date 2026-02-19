CREATE TABLE IF NOT EXISTS voice_consent_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
  identity_type text NOT NULL CHECK (identity_type IN ('phone', 'email')),
  identity_value text NOT NULL,
  consent_state text NOT NULL CHECK (consent_state IN ('granted', 'revoked')),
  callback_phone text,
  terms_version text,
  source text NOT NULL,
  event_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_voice_consent_events_customer
  ON voice_consent_events(customer_id, event_at DESC);

CREATE INDEX IF NOT EXISTS idx_voice_consent_events_identity
  ON voice_consent_events(identity_type, identity_value, event_at DESC);

CREATE INDEX IF NOT EXISTS idx_voice_consent_events_state_event
  ON voice_consent_events(consent_state, event_at DESC);

CREATE INDEX IF NOT EXISTS idx_voice_consent_events_callback_phone
  ON voice_consent_events(callback_phone, event_at DESC);