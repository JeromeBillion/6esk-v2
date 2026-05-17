-- 6esk v2: tenant-scoped AI Knowledge Base foundation.
-- This is the state boundary for SOP/business-knowledge RAG before extraction,
-- embedding, retrieval, and external connectors are enabled.

CREATE TABLE IF NOT EXISTS knowledge_folders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  parent_folder_id uuid,
  name text NOT NULL,
  description text,
  visibility text NOT NULL DEFAULT 'ai_visible'
    CHECK (visibility IN ('ai_visible', 'admin_only')),
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, parent_folder_id)
    REFERENCES knowledge_folders(tenant_id, id),
  CHECK (length(trim(name)) > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_knowledge_folders_tenant_parent_name_active
  ON knowledge_folders (
    tenant_id,
    COALESCE(parent_folder_id, '00000000-0000-0000-0000-000000000000'::uuid),
    lower(name)
  )
  WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_knowledge_folders_tenant_parent
  ON knowledge_folders(tenant_id, parent_folder_id, name)
  WHERE archived_at IS NULL;

CREATE TABLE IF NOT EXISTS knowledge_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  folder_id uuid,
  title text NOT NULL,
  source_type text NOT NULL DEFAULT 'direct_upload'
    CHECK (source_type IN ('direct_upload', 'connector_import')),
  document_kind text NOT NULL DEFAULT 'sop'
    CHECK (document_kind IN ('sop', 'policy', 'faq', 'product_manual', 'escalation_guide', 'compliance_note', 'playbook', 'other')),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'published', 'archived', 'deleted')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  deleted_at timestamptz,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, folder_id)
    REFERENCES knowledge_folders(tenant_id, id),
  CHECK (length(trim(title)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_knowledge_documents_tenant_folder_status
  ON knowledge_documents(tenant_id, folder_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_knowledge_documents_tenant_created
  ON knowledge_documents(tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS knowledge_document_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  document_id uuid NOT NULL,
  version_number integer NOT NULL CHECK (version_number > 0),
  status text NOT NULL DEFAULT 'uploaded'
    CHECK (status IN ('uploaded', 'processing', 'indexed', 'published', 'archived', 'failed', 'deleted')),
  original_filename text NOT NULL,
  content_type text NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes >= 0),
  checksum_sha256 text NOT NULL,
  object_key text NOT NULL,
  extracted_text_key text,
  page_count integer CHECK (page_count IS NULL OR page_count >= 0),
  chunk_count integer NOT NULL DEFAULT 0 CHECK (chunk_count >= 0),
  embedding_count integer NOT NULL DEFAULT 0 CHECK (embedding_count >= 0),
  extraction_error text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  uploaded_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  published_at timestamptz,
  archived_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, document_id, version_number),
  UNIQUE (tenant_id, object_key),
  FOREIGN KEY (tenant_id, document_id)
    REFERENCES knowledge_documents(tenant_id, id) ON DELETE CASCADE,
  CHECK (length(trim(original_filename)) > 0),
  CHECK (length(checksum_sha256) = 64)
);

CREATE INDEX IF NOT EXISTS idx_knowledge_document_versions_tenant_status
  ON knowledge_document_versions(tenant_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_knowledge_document_versions_published
  ON knowledge_document_versions(tenant_id, document_id, published_at DESC)
  WHERE status = 'published' AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_knowledge_document_versions_document_created
  ON knowledge_document_versions(tenant_id, document_id, created_at DESC);

CREATE TABLE IF NOT EXISTS knowledge_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  document_version_id uuid NOT NULL,
  chunk_index integer NOT NULL CHECK (chunk_index >= 0),
  content_text text NOT NULL,
  token_estimate integer CHECK (token_estimate IS NULL OR token_estimate >= 0),
  source_page integer CHECK (source_page IS NULL OR source_page > 0),
  source_heading text,
  source_locator text,
  content_hash text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, document_version_id, chunk_index),
  FOREIGN KEY (tenant_id, document_version_id)
    REFERENCES knowledge_document_versions(tenant_id, id) ON DELETE CASCADE,
  CHECK (length(trim(content_text)) > 0),
  CHECK (length(content_hash) = 64)
);

CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_tenant_version
  ON knowledge_chunks(tenant_id, document_version_id, chunk_index);

CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_fts
  ON knowledge_chunks USING GIN (to_tsvector('simple', content_text));

CREATE TABLE IF NOT EXISTS knowledge_embeddings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  chunk_id uuid NOT NULL,
  provider text NOT NULL,
  model text NOT NULL,
  embedding_dimensions integer CHECK (embedding_dimensions IS NULL OR embedding_dimensions > 0),
  embedding_ref text,
  embedding_hash text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, chunk_id, provider, model),
  FOREIGN KEY (tenant_id, chunk_id)
    REFERENCES knowledge_chunks(tenant_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_knowledge_embeddings_tenant_provider_model
  ON knowledge_embeddings(tenant_id, provider, model, created_at DESC);

CREATE TABLE IF NOT EXISTS knowledge_ingestion_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  document_version_id uuid NOT NULL,
  job_type text NOT NULL DEFAULT 'extract_and_index'
    CHECK (job_type IN ('scan', 'extract', 'embed', 'extract_and_index', 'reindex')),
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'indexed', 'failed', 'poison', 'cancelled')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_error text,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  locked_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, document_version_id)
    REFERENCES knowledge_document_versions(tenant_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_knowledge_ingestion_jobs_tenant_status_next
  ON knowledge_ingestion_jobs(tenant_id, status, next_attempt_at, created_at);

CREATE INDEX IF NOT EXISTS idx_knowledge_ingestion_jobs_version_created
  ON knowledge_ingestion_jobs(tenant_id, document_version_id, created_at DESC);

CREATE TABLE IF NOT EXISTS knowledge_retrieval_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  run_id text,
  resource_type text,
  resource_id uuid,
  query_purpose text NOT NULL,
  query_summary text,
  filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  result_document_version_ids uuid[] NOT NULL DEFAULT '{}',
  result_chunk_ids uuid[] NOT NULL DEFAULT '{}',
  scores jsonb NOT NULL DEFAULT '[]'::jsonb,
  confidence numeric,
  outcome text NOT NULL DEFAULT 'no_answer'
    CHECK (outcome IN ('answered', 'drafted', 'proposed_action', 'autonomous_action', 'no_answer', 'denied', 'error')),
  usage_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_knowledge_retrieval_events_tenant_created
  ON knowledge_retrieval_events(tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_knowledge_retrieval_events_tenant_run
  ON knowledge_retrieval_events(tenant_id, run_id)
  WHERE run_id IS NOT NULL;
