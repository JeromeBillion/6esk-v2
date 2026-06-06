CREATE TABLE IF NOT EXISTS tenant_public_ingress_origins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_key text NOT NULL DEFAULT 'primary',
  workspace_key text NOT NULL DEFAULT 'primary',
  origin text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tenant_public_ingress_origins_status_check
    CHECK (status IN ('active', 'paused', 'inactive'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_tenant_public_ingress_origins_active
  ON tenant_public_ingress_origins (lower(origin))
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_tenant_public_ingress_origins_tenant_status
  ON tenant_public_ingress_origins (tenant_key, workspace_key, status, created_at DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tenant_public_ingress_origins_workspace_fkey'
  ) THEN
    ALTER TABLE tenant_public_ingress_origins
      ADD CONSTRAINT tenant_public_ingress_origins_workspace_fkey
      FOREIGN KEY (tenant_key, workspace_key) REFERENCES workspaces(tenant_key, workspace_key)
      ON DELETE CASCADE;
  END IF;
END $$;
