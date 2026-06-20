-- 6esk v2: tenant-scoped Dexter prompt template versions.
-- Prompt templates are configuration snapshots, not instruction authority by
-- themselves. The runtime sandbox still enforces platform constraints first.

CREATE TABLE IF NOT EXISTS agent_prompt_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE,
  template_key text NOT NULL,
  template_version text NOT NULL,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'active', 'retired')),
  template_body jsonb NOT NULL DEFAULT '{}'::jsonb,
  template_hash text NOT NULL,
  activated_at timestamptz,
  retired_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  CHECK (length(trim(template_key)) > 0),
  CHECK (length(trim(template_version)) > 0),
  CHECK (length(trim(template_hash)) > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_prompt_templates_version_scope
  ON agent_prompt_templates (
    tenant_id,
    COALESCE(workspace_id, '00000000-0000-0000-0000-000000000000'::uuid),
    template_key,
    template_version
  );

CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_prompt_templates_active_scope
  ON agent_prompt_templates (
    tenant_id,
    COALESCE(workspace_id, '00000000-0000-0000-0000-000000000000'::uuid),
    template_key
  )
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_agent_prompt_templates_tenant_status
  ON agent_prompt_templates(tenant_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS agent_prompt_template_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE,
  template_id uuid NOT NULL,
  template_key text NOT NULL,
  template_version text NOT NULL,
  event_type text NOT NULL
    CHECK (event_type IN ('created', 'activated', 'rolled_back', 'retired')),
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  from_status text,
  to_status text,
  reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, template_id)
    REFERENCES agent_prompt_templates(tenant_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_agent_prompt_template_events_tenant_template
  ON agent_prompt_template_events(tenant_id, template_id, created_at DESC);
