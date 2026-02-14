CREATE TABLE customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('registered', 'unregistered')),
  external_system text,
  external_user_id text,
  display_name text,
  primary_email text,
  primary_phone text,
  merged_into_customer_id uuid REFERENCES customers(id),
  merge_reason text,
  merged_by_user_id uuid REFERENCES users(id),
  merged_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_customers_external_identity
  ON customers (external_system, external_user_id)
  WHERE external_system IS NOT NULL AND external_user_id IS NOT NULL;

CREATE INDEX idx_customers_primary_email ON customers (LOWER(primary_email));
CREATE INDEX idx_customers_primary_phone ON customers (primary_phone);
CREATE INDEX idx_customers_merged_into_customer_id ON customers (merged_into_customer_id);

CREATE TABLE customer_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  identity_type text NOT NULL CHECK (identity_type IN ('email', 'phone')),
  identity_value text NOT NULL,
  is_primary boolean NOT NULL DEFAULT false,
  source text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (identity_type, identity_value)
);

CREATE INDEX idx_customer_identities_customer_id ON customer_identities (customer_id);

ALTER TABLE tickets
  ADD COLUMN customer_id uuid REFERENCES customers(id),
  ADD COLUMN merged_into_ticket_id uuid REFERENCES tickets(id),
  ADD COLUMN merged_by_user_id uuid REFERENCES users(id),
  ADD COLUMN merged_at timestamptz;

CREATE INDEX idx_tickets_customer_id ON tickets(customer_id);
CREATE INDEX idx_tickets_merged_into_ticket_id ON tickets(merged_into_ticket_id);

CREATE TABLE ticket_merges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_ticket_id uuid NOT NULL REFERENCES tickets(id),
  target_ticket_id uuid NOT NULL REFERENCES tickets(id),
  source_channel message_channel NOT NULL,
  target_channel message_channel NOT NULL,
  reason text,
  actor_user_id uuid REFERENCES users(id),
  summary jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (source_ticket_id <> target_ticket_id)
);

CREATE INDEX idx_ticket_merges_source ON ticket_merges(source_ticket_id);
CREATE INDEX idx_ticket_merges_target ON ticket_merges(target_ticket_id);
CREATE INDEX idx_ticket_merges_created_at ON ticket_merges(created_at DESC);

CREATE TABLE customer_merges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_customer_id uuid NOT NULL REFERENCES customers(id),
  target_customer_id uuid NOT NULL REFERENCES customers(id),
  reason text,
  actor_user_id uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (source_customer_id <> target_customer_id)
);

CREATE INDEX idx_customer_merges_source ON customer_merges(source_customer_id);
CREATE INDEX idx_customer_merges_target ON customer_merges(target_customer_id);
CREATE INDEX idx_customer_merges_created_at ON customer_merges(created_at DESC);
