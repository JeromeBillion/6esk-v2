-- 6esk v2: persisted tenant-scoped machine ingress and provider webhook secrets.
-- Adds the v2-native tenant_id version of the launch-readiness work preserved
-- from the wrong-folder recovery branch.

CREATE TABLE IF NOT EXISTS tenant_ingress_signing_secrets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  workspace_key text NOT NULL DEFAULT 'primary',
  label text NOT NULL DEFAULT 'Machine ingress',
  status text NOT NULL DEFAULT 'active',
  secret_ciphertext text NOT NULL,
  secret_nonce text NOT NULL,
  secret_tag text NOT NULL,
  secret_fingerprint text NOT NULL,
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  rotated_from_secret_id uuid REFERENCES tenant_ingress_signing_secrets(id) ON DELETE SET NULL,
  expires_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tenant_ingress_signing_secrets_status_check
    CHECK (status IN ('active', 'retiring', 'revoked')),
  CONSTRAINT tenant_ingress_signing_secrets_workspace_fkey
    FOREIGN KEY (tenant_id, workspace_key)
    REFERENCES workspaces(tenant_id, workspace_key)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tenant_ingress_secrets_tenant_status
  ON tenant_ingress_signing_secrets (tenant_id, workspace_key, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_tenant_ingress_secrets_active
  ON tenant_ingress_signing_secrets (tenant_id, workspace_key, created_at DESC)
  WHERE status IN ('active', 'retiring');

CREATE UNIQUE INDEX IF NOT EXISTS uq_tenant_ingress_secrets_fingerprint
  ON tenant_ingress_signing_secrets (tenant_id, workspace_key, secret_fingerprint);

CREATE TABLE IF NOT EXISTS tenant_provider_webhook_secrets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
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
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  rotated_from_secret_id uuid REFERENCES tenant_provider_webhook_secrets(id) ON DELETE SET NULL,
  expires_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tenant_provider_webhook_secrets_status_check
    CHECK (status IN ('active', 'retiring', 'revoked')),
  CONSTRAINT tenant_provider_webhook_secrets_workspace_fkey
    FOREIGN KEY (tenant_id, workspace_key)
    REFERENCES workspaces(tenant_id, workspace_key)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tenant_provider_webhook_secrets_tenant_status
  ON tenant_provider_webhook_secrets (
    tenant_id, workspace_key, provider, secret_type, status, created_at DESC
  );

CREATE INDEX IF NOT EXISTS idx_tenant_provider_webhook_secrets_account
  ON tenant_provider_webhook_secrets (
    provider, secret_type, provider_account_id, status, created_at DESC
  )
  WHERE provider_account_id IS NOT NULL AND status IN ('active', 'retiring');

CREATE UNIQUE INDEX IF NOT EXISTS uq_tenant_provider_webhook_secrets_fingerprint
  ON tenant_provider_webhook_secrets (
    tenant_id, workspace_key, provider, secret_type, COALESCE(provider_account_id, ''), secret_fingerprint
  );
