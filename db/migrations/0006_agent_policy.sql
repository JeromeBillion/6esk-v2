ALTER TABLE agent_integrations
  ADD COLUMN policy jsonb NOT NULL DEFAULT '{}'::jsonb;
