-- Tenant-scoped Knowledge Base ingestion security diagnostics.
-- Rejected or poison uploads are recorded without storing document text in Postgres.

CREATE TABLE IF NOT EXISTS knowledge_quarantine_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  document_id uuid,
  document_version_id uuid,
  ingestion_job_id uuid,
  original_filename text NOT NULL,
  content_type text NOT NULL,
  checksum_sha256 text NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes >= 0),
  reason_code text NOT NULL,
  scanner_status text NOT NULL DEFAULT 'not_scanned',
  scanner text,
  scanner_signature text,
  detail text,
  storage_provider text,
  storage_bucket text,
  storage_key text,
  stored_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  CHECK (length(trim(original_filename)) > 0),
  CHECK (length(checksum_sha256) = 64)
);

CREATE INDEX IF NOT EXISTS idx_knowledge_quarantine_tenant_created
  ON knowledge_quarantine_events(tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_knowledge_quarantine_tenant_reason
  ON knowledge_quarantine_events(tenant_id, reason_code, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_knowledge_quarantine_storage_key
  ON knowledge_quarantine_events(tenant_id, storage_key)
  WHERE storage_key IS NOT NULL;
