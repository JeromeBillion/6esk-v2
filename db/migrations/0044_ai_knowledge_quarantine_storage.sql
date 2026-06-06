ALTER TABLE ai_knowledge_quarantine_events
  ADD COLUMN IF NOT EXISTS storage_provider text,
  ADD COLUMN IF NOT EXISTS storage_bucket text,
  ADD COLUMN IF NOT EXISTS storage_key text,
  ADD COLUMN IF NOT EXISTS stored_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_ai_knowledge_quarantine_storage_key
  ON ai_knowledge_quarantine_events (tenant_key, workspace_key, storage_key)
  WHERE storage_key IS NOT NULL;
