CREATE TABLE IF NOT EXISTS ai_guard_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_key text NOT NULL DEFAULT 'primary',
  workspace_key text NOT NULL DEFAULT 'primary',
  run_id text,
  integration_id text,
  source_kind text NOT NULL,
  source_id text,
  subject text,
  severity text NOT NULL,
  decision text NOT NULL,
  reason_codes text[] NOT NULL DEFAULT ARRAY[]::text[],
  guard_version text NOT NULL,
  content_sample text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ai_policy_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_key text NOT NULL DEFAULT 'primary',
  workspace_key text NOT NULL DEFAULT 'primary',
  run_id text,
  integration_id text,
  policy_mode text NOT NULL,
  tool_name text NOT NULL,
  tool_class text NOT NULL,
  decision text NOT NULL,
  reason_codes text[] NOT NULL DEFAULT ARRAY[]::text[],
  resource jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_guard_events_tenant_created
  ON ai_guard_events (tenant_key, workspace_key, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_guard_events_run
  ON ai_guard_events (run_id, created_at DESC)
  WHERE run_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ai_guard_events_reason_codes
  ON ai_guard_events USING gin (reason_codes);

CREATE INDEX IF NOT EXISTS idx_ai_policy_decisions_tenant_created
  ON ai_policy_decisions (tenant_key, workspace_key, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_policy_decisions_run
  ON ai_policy_decisions (run_id, created_at DESC)
  WHERE run_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ai_policy_decisions_tool
  ON ai_policy_decisions (tenant_key, tool_name, decision, created_at DESC);
