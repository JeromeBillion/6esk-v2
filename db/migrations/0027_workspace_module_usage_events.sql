CREATE TABLE IF NOT EXISTS workspace_module_usage_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_key text NOT NULL DEFAULT 'primary',
  module_key text NOT NULL,
  usage_kind text NOT NULL,
  quantity integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit text NOT NULL DEFAULT 'event',
  actor_type text NOT NULL CHECK (actor_type IN ('human', 'ai', 'system')),
  provider_mode text NULL CHECK (provider_mode IN ('managed', 'byo', 'none')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS workspace_module_usage_events_workspace_module_created_idx
  ON workspace_module_usage_events (workspace_key, module_key, created_at DESC);

CREATE INDEX IF NOT EXISTS workspace_module_usage_events_kind_created_idx
  ON workspace_module_usage_events (module_key, usage_kind, created_at DESC);
