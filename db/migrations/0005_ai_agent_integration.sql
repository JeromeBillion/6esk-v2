CREATE TYPE message_origin AS ENUM ('human', 'ai');
CREATE TYPE agent_policy_mode AS ENUM ('draft_only', 'auto_send');

ALTER TABLE messages
  ADD COLUMN origin message_origin NOT NULL DEFAULT 'human',
  ADD COLUMN ai_meta jsonb;

CREATE TABLE agent_integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  provider text NOT NULL DEFAULT 'elizaos',
  base_url text NOT NULL,
  auth_type text NOT NULL DEFAULT 'hmac',
  shared_secret text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  policy_mode agent_policy_mode NOT NULL DEFAULT 'draft_only',
  scopes jsonb NOT NULL DEFAULT '{}'::jsonb,
  capabilities jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE agent_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_id uuid REFERENCES agent_integrations(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  attempt_count integer NOT NULL DEFAULT 0,
  last_error text,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE agent_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_id uuid REFERENCES agent_integrations(id) ON DELETE SET NULL,
  ticket_id uuid REFERENCES tickets(id) ON DELETE CASCADE,
  subject text,
  body_text text,
  body_html text,
  confidence numeric,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_agent_outbox_status_next_attempt ON agent_outbox(status, next_attempt_at);
CREATE INDEX idx_agent_outbox_integration_id ON agent_outbox(integration_id);
CREATE INDEX idx_agent_drafts_ticket_id ON agent_drafts(ticket_id);
