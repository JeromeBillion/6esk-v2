CREATE TABLE IF NOT EXISTS agent_action_idempotency (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  integration_id uuid NOT NULL REFERENCES agent_integrations(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL,
  action_type text NOT NULL,
  ticket_id uuid NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  request_hash text NOT NULL,
  status text NOT NULL DEFAULT 'processing',
  response jsonb,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_action_idempotency_tenant_integration_key
  ON agent_action_idempotency(tenant_id, integration_id, idempotency_key);

CREATE INDEX IF NOT EXISTS idx_agent_action_idempotency_ticket_created
  ON agent_action_idempotency(tenant_id, ticket_id, created_at DESC);
