DO $$
BEGIN
  CREATE TYPE message_channel AS ENUM ('email', 'whatsapp');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS channel message_channel NOT NULL DEFAULT 'email',
  ADD COLUMN IF NOT EXISTS external_message_id text,
  ADD COLUMN IF NOT EXISTS conversation_id text,
  ADD COLUMN IF NOT EXISTS wa_contact text,
  ADD COLUMN IF NOT EXISTS wa_status text,
  ADD COLUMN IF NOT EXISTS wa_timestamp timestamptz,
  ADD COLUMN IF NOT EXISTS provider text;

CREATE TABLE IF NOT EXISTS whatsapp_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL DEFAULT 'meta',
  phone_number text NOT NULL,
  waba_id text,
  access_token text,
  verify_token text,
  status text NOT NULL DEFAULT 'inactive',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS whatsapp_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  direction text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'received',
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
