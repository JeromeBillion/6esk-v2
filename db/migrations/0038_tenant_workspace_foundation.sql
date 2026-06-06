CREATE TABLE IF NOT EXISTS tenants (
  tenant_key text PRIMARY KEY,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS organizations (
  tenant_key text NOT NULL REFERENCES tenants(tenant_key) ON DELETE RESTRICT,
  organization_key text NOT NULL,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_key, organization_key)
);

CREATE TABLE IF NOT EXISTS workspaces (
  tenant_key text NOT NULL REFERENCES tenants(tenant_key) ON DELETE RESTRICT,
  workspace_key text NOT NULL,
  organization_key text,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_key, workspace_key),
  FOREIGN KEY (tenant_key, organization_key)
    REFERENCES organizations(tenant_key, organization_key) ON DELETE RESTRICT
);

INSERT INTO tenants (tenant_key, name, status)
VALUES ('primary', 'Primary Tenant', 'active')
ON CONFLICT (tenant_key) DO NOTHING;

INSERT INTO organizations (organization_key, tenant_key, name, status)
VALUES ('primary', 'primary', 'Primary Organization', 'active')
ON CONFLICT (tenant_key, organization_key) DO NOTHING;

INSERT INTO workspaces (workspace_key, tenant_key, organization_key, name, status)
VALUES ('primary', 'primary', 'primary', 'Primary Workspace', 'active')
ON CONFLICT (tenant_key, workspace_key) DO NOTHING;

ALTER TABLE agent_integrations
  ADD COLUMN IF NOT EXISTS tenant_key text NOT NULL DEFAULT 'primary';

ALTER TABLE workspace_modules
  ADD COLUMN IF NOT EXISTS tenant_key text NOT NULL DEFAULT 'primary';

ALTER TABLE workspace_module_usage_events
  ADD COLUMN IF NOT EXISTS tenant_key text NOT NULL DEFAULT 'primary';

INSERT INTO workspaces (workspace_key, tenant_key, organization_key, name, status)
SELECT DISTINCT workspace_key, tenant_key, 'primary', workspace_key, 'active'
FROM workspace_modules
ON CONFLICT (tenant_key, workspace_key) DO NOTHING;

INSERT INTO workspaces (workspace_key, tenant_key, organization_key, name, status)
SELECT DISTINCT workspace_key, tenant_key, 'primary', workspace_key, 'active'
FROM workspace_module_usage_events
ON CONFLICT (tenant_key, workspace_key) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_agent_integrations_tenant_status
  ON agent_integrations (tenant_key, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_workspace_modules_tenant_workspace
  ON workspace_modules (tenant_key, workspace_key);

CREATE INDEX IF NOT EXISTS idx_workspace_module_usage_events_tenant_module_created
  ON workspace_module_usage_events (tenant_key, workspace_key, module_key, created_at DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'agent_integrations_tenant_key_fkey'
  ) THEN
    ALTER TABLE agent_integrations
      ADD CONSTRAINT agent_integrations_tenant_key_fkey
      FOREIGN KEY (tenant_key) REFERENCES tenants(tenant_key) ON DELETE RESTRICT;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'workspace_modules_workspace_fkey'
  ) THEN
    ALTER TABLE workspace_modules
      ADD CONSTRAINT workspace_modules_workspace_fkey
      FOREIGN KEY (tenant_key, workspace_key) REFERENCES workspaces(tenant_key, workspace_key)
      ON DELETE RESTRICT;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'workspace_module_usage_events_workspace_fkey'
  ) THEN
    ALTER TABLE workspace_module_usage_events
      ADD CONSTRAINT workspace_module_usage_events_workspace_fkey
      FOREIGN KEY (tenant_key, workspace_key) REFERENCES workspaces(tenant_key, workspace_key)
      ON DELETE RESTRICT;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'agent_outbox_tenant_key_fkey'
  ) THEN
    ALTER TABLE agent_outbox
      ADD CONSTRAINT agent_outbox_tenant_key_fkey
      FOREIGN KEY (tenant_key) REFERENCES tenants(tenant_key) ON DELETE RESTRICT;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'agent_runs_tenant_key_fkey'
  ) THEN
    ALTER TABLE agent_runs
      ADD CONSTRAINT agent_runs_tenant_key_fkey
      FOREIGN KEY (tenant_key) REFERENCES tenants(tenant_key) ON DELETE RESTRICT;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ai_knowledge_folders_workspace_fkey'
  ) THEN
    ALTER TABLE ai_knowledge_folders
      ADD CONSTRAINT ai_knowledge_folders_workspace_fkey
      FOREIGN KEY (tenant_key, workspace_key) REFERENCES workspaces(tenant_key, workspace_key)
      ON DELETE RESTRICT;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ai_knowledge_documents_workspace_fkey'
  ) THEN
    ALTER TABLE ai_knowledge_documents
      ADD CONSTRAINT ai_knowledge_documents_workspace_fkey
      FOREIGN KEY (tenant_key, workspace_key) REFERENCES workspaces(tenant_key, workspace_key)
      ON DELETE RESTRICT;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ai_knowledge_chunks_workspace_fkey'
  ) THEN
    ALTER TABLE ai_knowledge_chunks
      ADD CONSTRAINT ai_knowledge_chunks_workspace_fkey
      FOREIGN KEY (tenant_key, workspace_key) REFERENCES workspaces(tenant_key, workspace_key)
      ON DELETE RESTRICT;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ai_knowledge_retrieval_events_workspace_fkey'
  ) THEN
    ALTER TABLE ai_knowledge_retrieval_events
      ADD CONSTRAINT ai_knowledge_retrieval_events_workspace_fkey
      FOREIGN KEY (tenant_key, workspace_key) REFERENCES workspaces(tenant_key, workspace_key)
      ON DELETE RESTRICT;
  END IF;
END $$;
