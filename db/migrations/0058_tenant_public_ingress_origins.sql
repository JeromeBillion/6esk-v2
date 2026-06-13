-- 6esk v2: tenant-scoped public ingress origin allowlist.
-- This ports the wrong-folder public-origin safety idea into the v2 tenant_id model.

CREATE TABLE IF NOT EXISTS tenant_public_ingress_origins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  workspace_key text NOT NULL DEFAULT 'primary',
  origin text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tenant_public_ingress_origins_status_check
    CHECK (status IN ('active', 'paused', 'inactive')),
  CONSTRAINT tenant_public_ingress_origins_workspace_fkey
    FOREIGN KEY (tenant_id, workspace_key)
    REFERENCES workspaces(tenant_id, workspace_key)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tenant_public_ingress_origins_tenant_status
  ON tenant_public_ingress_origins (tenant_id, workspace_key, status, origin);

CREATE UNIQUE INDEX IF NOT EXISTS uq_tenant_public_ingress_origins_active_origin
  ON tenant_public_ingress_origins (lower(origin))
  WHERE status = 'active';
