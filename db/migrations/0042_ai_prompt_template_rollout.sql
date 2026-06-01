CREATE TABLE IF NOT EXISTS ai_prompt_template_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_key text NOT NULL DEFAULT 'primary',
  workspace_key text NOT NULL DEFAULT 'primary',
  template_id uuid REFERENCES ai_prompt_templates(id) ON DELETE SET NULL,
  template_key text NOT NULL,
  template_version text NOT NULL,
  event_type text NOT NULL,
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  from_status text,
  to_status text,
  reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_prompt_templates_one_active
  ON ai_prompt_templates (tenant_key, workspace_key, template_key)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_ai_prompt_template_events_template
  ON ai_prompt_template_events (tenant_key, workspace_key, template_key, created_at DESC);
