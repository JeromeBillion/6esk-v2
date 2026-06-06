CREATE TABLE IF NOT EXISTS tenant_provider_webhook_secrets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_key text NOT NULL DEFAULT 'primary',
  workspace_key text NOT NULL DEFAULT 'primary',
  provider text NOT NULL,
  secret_type text NOT NULL,
  provider_account_id text,
  label text NOT NULL DEFAULT 'Provider webhook secret',
  status text NOT NULL DEFAULT 'active',
  secret_ciphertext text NOT NULL,
  secret_nonce text NOT NULL,
  secret_tag text NOT NULL,
  secret_fingerprint text NOT NULL,
  created_by_user_id uuid,
  rotated_from_secret_id uuid REFERENCES tenant_provider_webhook_secrets(id) ON DELETE SET NULL,
  expires_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tenant_provider_webhook_secrets_status_check
    CHECK (status IN ('active', 'retiring', 'revoked'))
);

CREATE INDEX IF NOT EXISTS idx_tenant_provider_webhook_secrets_tenant_status
  ON tenant_provider_webhook_secrets (
    tenant_key, workspace_key, provider, secret_type, status, created_at DESC
  );

CREATE INDEX IF NOT EXISTS idx_tenant_provider_webhook_secrets_account
  ON tenant_provider_webhook_secrets (
    provider, secret_type, provider_account_id, status, created_at DESC
  )
  WHERE provider_account_id IS NOT NULL AND status IN ('active', 'retiring');

CREATE UNIQUE INDEX IF NOT EXISTS uq_tenant_provider_webhook_secrets_fingerprint
  ON tenant_provider_webhook_secrets (
    tenant_key, workspace_key, provider, secret_type, COALESCE(provider_account_id, ''), secret_fingerprint
  );

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tenant_provider_webhook_secrets_workspace_fkey'
  ) THEN
    ALTER TABLE tenant_provider_webhook_secrets
      ADD CONSTRAINT tenant_provider_webhook_secrets_workspace_fkey
      FOREIGN KEY (tenant_key, workspace_key) REFERENCES workspaces(tenant_key, workspace_key)
      ON DELETE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tenant_provider_webhook_secrets_created_by_fkey'
  ) THEN
    ALTER TABLE tenant_provider_webhook_secrets
      ADD CONSTRAINT tenant_provider_webhook_secrets_created_by_fkey
      FOREIGN KEY (created_by_user_id) REFERENCES users(id)
      ON DELETE SET NULL;
  END IF;
END $$;
