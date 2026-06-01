DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum
    WHERE enumlabel = 'hybrid_review'
      AND enumtypid = 'agent_policy_mode'::regtype
  ) THEN
    ALTER TYPE agent_policy_mode ADD VALUE 'hybrid_review';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum
    WHERE enumlabel = 'full_auto'
      AND enumtypid = 'agent_policy_mode'::regtype
  ) THEN
    ALTER TYPE agent_policy_mode ADD VALUE 'full_auto';
  END IF;
END $$;

ALTER TABLE agent_outbox
  ADD COLUMN IF NOT EXISTS tenant_key text NOT NULL DEFAULT 'primary',
  ADD COLUMN IF NOT EXISTS lane_key text,
  ADD COLUMN IF NOT EXISTS idempotency_key text,
  ADD COLUMN IF NOT EXISTS command_envelope jsonb;

CREATE TABLE IF NOT EXISTS agent_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_key text NOT NULL DEFAULT 'primary',
  integration_id uuid REFERENCES agent_integrations(id) ON DELETE SET NULL,
  mode text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  lane_key text NOT NULL,
  source_event_type text,
  resource jsonb NOT NULL DEFAULT '{}'::jsonb,
  command_envelope jsonb NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key text,
  error text,
  queued_at timestamptz NOT NULL DEFAULT now(),
  dispatched_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agent_run_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  status text,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agent_run_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  step_type text NOT NULL,
  status text NOT NULL,
  input jsonb NOT NULL DEFAULT '{}'::jsonb,
  output jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE TABLE IF NOT EXISTS agent_tool_calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  step_id uuid REFERENCES agent_run_steps(id) ON DELETE SET NULL,
  tool_name text NOT NULL,
  status text NOT NULL,
  request jsonb NOT NULL DEFAULT '{}'::jsonb,
  response jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_agent_outbox_lane_status
  ON agent_outbox (integration_id, tenant_key, lane_key, status, next_attempt_at, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_outbox_idempotency_key
  ON agent_outbox (integration_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_agent_runs_integration_status
  ON agent_runs (integration_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_runs_tenant_lane_status
  ON agent_runs (tenant_key, lane_key, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_run_events_run_created
  ON agent_run_events (run_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_agent_run_steps_run_started
  ON agent_run_steps (run_id, started_at ASC);

CREATE INDEX IF NOT EXISTS idx_agent_tool_calls_run_requested
  ON agent_tool_calls (run_id, requested_at ASC);
