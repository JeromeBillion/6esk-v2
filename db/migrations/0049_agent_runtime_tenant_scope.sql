ALTER TABLE agent_outbox
  ADD COLUMN IF NOT EXISTS workspace_key text NOT NULL DEFAULT 'primary';

ALTER TABLE agent_runs
  ADD COLUMN IF NOT EXISTS workspace_key text NOT NULL DEFAULT 'primary';

ALTER TABLE agent_run_events
  ADD COLUMN IF NOT EXISTS tenant_key text NOT NULL DEFAULT 'primary',
  ADD COLUMN IF NOT EXISTS workspace_key text NOT NULL DEFAULT 'primary';

ALTER TABLE agent_run_steps
  ADD COLUMN IF NOT EXISTS tenant_key text NOT NULL DEFAULT 'primary',
  ADD COLUMN IF NOT EXISTS workspace_key text NOT NULL DEFAULT 'primary';

ALTER TABLE agent_tool_calls
  ADD COLUMN IF NOT EXISTS tenant_key text NOT NULL DEFAULT 'primary',
  ADD COLUMN IF NOT EXISTS workspace_key text NOT NULL DEFAULT 'primary';

UPDATE agent_outbox
SET workspace_key = COALESCE(NULLIF(command_envelope->>'workspace_key', ''), workspace_key, 'primary')
WHERE command_envelope ? 'workspace_key';

UPDATE agent_runs
SET workspace_key = COALESCE(NULLIF(command_envelope->>'workspace_key', ''), workspace_key, 'primary')
WHERE command_envelope ? 'workspace_key';

UPDATE agent_run_events event
SET tenant_key = run.tenant_key,
    workspace_key = run.workspace_key
FROM agent_runs run
WHERE event.run_id = run.id;

UPDATE agent_run_steps step
SET tenant_key = run.tenant_key,
    workspace_key = run.workspace_key
FROM agent_runs run
WHERE step.run_id = run.id;

UPDATE agent_tool_calls tool
SET tenant_key = run.tenant_key,
    workspace_key = run.workspace_key
FROM agent_runs run
WHERE tool.run_id = run.id;

CREATE INDEX IF NOT EXISTS idx_agent_outbox_tenant_workspace_status
  ON agent_outbox (tenant_key, workspace_key, status, next_attempt_at, updated_at);

CREATE INDEX IF NOT EXISTS idx_agent_runs_tenant_workspace_status
  ON agent_runs (tenant_key, workspace_key, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_run_events_tenant_run_created
  ON agent_run_events (tenant_key, workspace_key, run_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_agent_run_steps_tenant_run_started
  ON agent_run_steps (tenant_key, workspace_key, run_id, started_at ASC);

CREATE INDEX IF NOT EXISTS idx_agent_tool_calls_tenant_run_requested
  ON agent_tool_calls (tenant_key, workspace_key, run_id, requested_at ASC);
