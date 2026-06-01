CREATE TABLE IF NOT EXISTS tenant_ingress_signing_secrets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_key text NOT NULL DEFAULT 'primary',
  workspace_key text NOT NULL DEFAULT 'primary',
  label text NOT NULL DEFAULT 'Machine ingress',
  status text NOT NULL DEFAULT 'active',
  secret_ciphertext text NOT NULL,
  secret_nonce text NOT NULL,
  secret_tag text NOT NULL,
  secret_fingerprint text NOT NULL,
  created_by_user_id uuid,
  rotated_from_secret_id uuid REFERENCES tenant_ingress_signing_secrets(id) ON DELETE SET NULL,
  expires_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tenant_ingress_signing_secrets_status_check
    CHECK (status IN ('active', 'retiring', 'revoked'))
);

CREATE INDEX IF NOT EXISTS idx_tenant_ingress_secrets_tenant_status
  ON tenant_ingress_signing_secrets (tenant_key, workspace_key, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_tenant_ingress_secrets_active
  ON tenant_ingress_signing_secrets (tenant_key, workspace_key, created_at DESC)
  WHERE status IN ('active', 'retiring');

CREATE UNIQUE INDEX IF NOT EXISTS uq_tenant_ingress_secrets_fingerprint
  ON tenant_ingress_signing_secrets (tenant_key, workspace_key, secret_fingerprint);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tenant_ingress_signing_secrets_workspace_fkey'
  ) THEN
    ALTER TABLE tenant_ingress_signing_secrets
      ADD CONSTRAINT tenant_ingress_signing_secrets_workspace_fkey
      FOREIGN KEY (tenant_key, workspace_key) REFERENCES workspaces(tenant_key, workspace_key)
      ON DELETE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tenant_ingress_signing_secrets_created_by_fkey'
  ) THEN
    ALTER TABLE tenant_ingress_signing_secrets
      ADD CONSTRAINT tenant_ingress_signing_secrets_created_by_fkey
      FOREIGN KEY (created_by_user_id) REFERENCES users(id)
      ON DELETE SET NULL;
  END IF;
END $$;
