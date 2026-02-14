CREATE TABLE external_user_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_system text NOT NULL,
  external_user_id text NOT NULL,
  email text,
  phone text,
  matched_by text,
  confidence numeric(5,4),
  last_ticket_id uuid REFERENCES tickets(id) ON DELETE SET NULL,
  last_channel message_channel,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (external_system, external_user_id),
  CHECK (email IS NOT NULL OR phone IS NOT NULL)
);

CREATE INDEX idx_external_user_links_email ON external_user_links (LOWER(email));
CREATE INDEX idx_external_user_links_phone ON external_user_links (phone);
CREATE INDEX idx_external_user_links_last_seen_at ON external_user_links (last_seen_at DESC);
