CREATE TABLE IF NOT EXISTS ai_knowledge_quarantine_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_key text NOT NULL DEFAULT 'primary',
  workspace_key text NOT NULL DEFAULT 'primary',
  filename text NOT NULL,
  content_type text NOT NULL,
  checksum_sha256 text NOT NULL,
  byte_size integer NOT NULL,
  reason_code text NOT NULL,
  scanner_status text NOT NULL DEFAULT 'not_scanned',
  scanner text,
  scanner_signature text,
  detail text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_knowledge_quarantine_workspace
  ON ai_knowledge_quarantine_events (tenant_key, workspace_key, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_knowledge_quarantine_reason
  ON ai_knowledge_quarantine_events (tenant_key, workspace_key, reason_code, created_at DESC);
