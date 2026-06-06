CREATE TABLE IF NOT EXISTS ai_knowledge_folders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_key text NOT NULL DEFAULT 'primary',
  workspace_key text NOT NULL DEFAULT 'primary',
  parent_id uuid REFERENCES ai_knowledge_folders(id) ON DELETE SET NULL,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ai_knowledge_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_key text NOT NULL DEFAULT 'primary',
  workspace_key text NOT NULL DEFAULT 'primary',
  folder_id uuid REFERENCES ai_knowledge_folders(id) ON DELETE SET NULL,
  source_kind text NOT NULL DEFAULT 'admin_upload',
  filename text NOT NULL,
  title text,
  content_type text NOT NULL,
  checksum_sha256 text NOT NULL,
  byte_size integer NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  extraction_status text NOT NULL DEFAULT 'completed',
  extraction_error text,
  body_text text NOT NULL DEFAULT '',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ai_knowledge_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES ai_knowledge_documents(id) ON DELETE CASCADE,
  tenant_key text NOT NULL DEFAULT 'primary',
  workspace_key text NOT NULL DEFAULT 'primary',
  chunk_index integer NOT NULL,
  content text NOT NULL,
  token_estimate integer NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id, chunk_index)
);

CREATE TABLE IF NOT EXISTS ai_knowledge_retrieval_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_key text NOT NULL DEFAULT 'primary',
  workspace_key text NOT NULL DEFAULT 'primary',
  query text NOT NULL,
  result_count integer NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_knowledge_folders_workspace
  ON ai_knowledge_folders (tenant_key, workspace_key, parent_id, name);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_knowledge_folders_name_unique
  ON ai_knowledge_folders (tenant_key, workspace_key, COALESCE(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name));

CREATE INDEX IF NOT EXISTS idx_ai_knowledge_documents_workspace
  ON ai_knowledge_documents (tenant_key, workspace_key, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_knowledge_chunks_workspace
  ON ai_knowledge_chunks (tenant_key, workspace_key, document_id, chunk_index);

CREATE INDEX IF NOT EXISTS idx_ai_knowledge_chunks_fts
  ON ai_knowledge_chunks
  USING gin (to_tsvector('simple', content));

CREATE INDEX IF NOT EXISTS idx_ai_knowledge_retrieval_workspace
  ON ai_knowledge_retrieval_events (tenant_key, workspace_key, created_at DESC);
