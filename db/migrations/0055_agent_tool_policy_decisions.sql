-- 6esk v2: tenant-scoped Dexter tool policy evidence.
-- LLM/tool intent must be evaluated by backend policy before customer contact
-- or CRM mutation. This table preserves the decision without storing raw prompts.

CREATE TABLE IF NOT EXISTS agent_tool_policy_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  integration_id uuid REFERENCES agent_integrations(id) ON DELETE SET NULL,
  run_id uuid,
  policy_mode text NOT NULL
    CHECK (policy_mode IN ('dry_run', 'draft_only', 'hybrid_review', 'full_auto')),
  rollout_mode text,
  action_type text NOT NULL,
  tool_class text NOT NULL
    CHECK (tool_class IN ('review_request', 'draft', 'reversible_write', 'external_send', 'irreversible_write')),
  decision text NOT NULL
    CHECK (decision IN ('allow', 'needs_review', 'read_only', 'block')),
  reason_codes jsonb NOT NULL DEFAULT '[]'::jsonb,
  resource jsonb NOT NULL DEFAULT '{}'::jsonb,
  prompt_safety jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (length(trim(action_type)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_agent_tool_policy_decisions_tenant_created
  ON agent_tool_policy_decisions(tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_tool_policy_decisions_tenant_decision
  ON agent_tool_policy_decisions(tenant_id, decision, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_tool_policy_decisions_tenant_run
  ON agent_tool_policy_decisions(tenant_id, run_id, created_at DESC)
  WHERE run_id IS NOT NULL;
