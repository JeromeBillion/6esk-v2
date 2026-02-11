ALTER TABLE agent_drafts
  ADD COLUMN IF NOT EXISTS metadata jsonb;
