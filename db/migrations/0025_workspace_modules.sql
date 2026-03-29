CREATE TABLE IF NOT EXISTS workspace_modules (
  workspace_key text PRIMARY KEY,
  modules jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO workspace_modules (workspace_key, modules)
VALUES (
  'primary',
  jsonb_build_object(
    'email', true,
    'whatsapp', true,
    'voice', true,
    'aiAutomation', true,
    'venusOrchestration', true,
    'vanillaWebchat', true
  )
)
ON CONFLICT (workspace_key) DO NOTHING;
