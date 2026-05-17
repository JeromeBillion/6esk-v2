-- 6esk v2: durable Dexter run ledger foundation.
-- Postgres is the source of truth for CRM-side agent run state. The native
-- runtime may change, restart, or be replaced without erasing run evidence.

ALTER TABLE agent_integrations
  ADD CONSTRAINT uq_agent_integrations_tenant_id_id UNIQUE (tenant_id, id);

ALTER TABLE agent_outbox
  ADD CONSTRAINT uq_agent_outbox_tenant_id_id UNIQUE (tenant_id, id);

CREATE TABLE IF NOT EXISTS agent_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  integration_id uuid,
  run_type text NOT NULL DEFAULT 'outbox_event'
    CHECK (run_type IN ('outbox_event', 'manual', 'scheduled', 'replay')),
  status text NOT NULL DEFAULT 'created'
    CHECK (status IN ('created', 'queued', 'running', 'waiting_approval', 'completed', 'failed', 'timed_out', 'cancelled', 'lost')),
  lane_key text NOT NULL,
  source_channel text,
  resource_type text,
  resource_id uuid,
  trigger_event_type text,
  trigger_outbox_id uuid,
  idempotency_key text,
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  machine_actor text,
  requested_scopes jsonb NOT NULL DEFAULT '[]'::jsonb,
  rollout_mode text,
  provider_mode text,
  failure_reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  queued_at timestamptz,
  started_at timestamptz,
  waiting_since timestamptz,
  completed_at timestamptz,
  failed_at timestamptz,
  timed_out_at timestamptz,
  cancelled_at timestamptz,
  lost_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, integration_id)
    REFERENCES agent_integrations(tenant_id, id) ON DELETE RESTRICT,
  CHECK (length(trim(lane_key)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_agent_runs_tenant_status_updated
  ON agent_runs(tenant_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_runs_tenant_lane_status
  ON agent_runs(tenant_id, lane_key, status, created_at);

CREATE INDEX IF NOT EXISTS idx_agent_runs_tenant_resource
  ON agent_runs(tenant_id, resource_type, resource_id, created_at DESC)
  WHERE resource_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_agent_runs_tenant_outbox
  ON agent_runs(tenant_id, trigger_outbox_id)
  WHERE trigger_outbox_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS agent_run_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  run_id uuid NOT NULL,
  sequence integer NOT NULL CHECK (sequence > 0),
  event_type text NOT NULL,
  status text,
  summary text,
  event_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, run_id, sequence),
  FOREIGN KEY (tenant_id, run_id)
    REFERENCES agent_runs(tenant_id, id) ON DELETE CASCADE,
  CHECK (length(trim(event_type)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_agent_run_events_tenant_run_created
  ON agent_run_events(tenant_id, run_id, sequence);

CREATE TABLE IF NOT EXISTS agent_run_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  run_id uuid NOT NULL,
  step_index integer NOT NULL CHECK (step_index >= 0),
  step_type text NOT NULL,
  status text NOT NULL DEFAULT 'created'
    CHECK (status IN ('created', 'running', 'waiting_approval', 'completed', 'failed', 'skipped', 'cancelled')),
  summary text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  failed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, run_id, step_index),
  FOREIGN KEY (tenant_id, run_id)
    REFERENCES agent_runs(tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS agent_tool_calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  run_id uuid NOT NULL,
  step_id uuid,
  tool_name text NOT NULL,
  status text NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested', 'approved', 'denied', 'running', 'completed', 'failed', 'cancelled')),
  requested_scopes jsonb NOT NULL DEFAULT '[]'::jsonb,
  args_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  result_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, run_id)
    REFERENCES agent_runs(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, step_id)
    REFERENCES agent_run_steps(tenant_id, id) ON DELETE RESTRICT,
  CHECK (length(trim(tool_name)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_agent_tool_calls_tenant_run_created
  ON agent_tool_calls(tenant_id, run_id, created_at);

CREATE INDEX IF NOT EXISTS idx_agent_tool_calls_tenant_status
  ON agent_tool_calls(tenant_id, status, created_at DESC);

ALTER TABLE agent_outbox
  ADD COLUMN IF NOT EXISTS run_id uuid;

ALTER TABLE agent_outbox
  ADD CONSTRAINT fk_agent_outbox_run_tenant
  FOREIGN KEY (tenant_id, run_id)
  REFERENCES agent_runs(tenant_id, id)
  ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_agent_outbox_tenant_run
  ON agent_outbox(tenant_id, run_id)
  WHERE run_id IS NOT NULL;
