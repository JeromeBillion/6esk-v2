CREATE TABLE IF NOT EXISTS tenant_security_policies (
  tenant_key text NOT NULL,
  workspace_key text NOT NULL,
  allowed_login_domains text[] NOT NULL DEFAULT '{}',
  enforce_sso boolean NOT NULL DEFAULT false,
  require_mfa_for_admins boolean NOT NULL DEFAULT true,
  session_ttl_days integer NOT NULL DEFAULT 14 CHECK (session_ttl_days > 0 AND session_ttl_days <= 90),
  auth_provider text NOT NULL DEFAULT 'password' CHECK (auth_provider IN ('password', 'better_auth', 'oidc_broker')),
  oidc_issuer text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_key, workspace_key)
);

CREATE TABLE IF NOT EXISTS auth_identity_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_key text NOT NULL,
  workspace_key text NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider text NOT NULL,
  provider_account_id text NOT NULL,
  provider_email text,
  access_token_encrypted text,
  refresh_token_encrypted text,
  token_expires_at timestamptz,
  scopes text[] NOT NULL DEFAULT '{}',
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_key, provider, provider_account_id)
);

CREATE INDEX IF NOT EXISTS idx_auth_identity_accounts_tenant_user
  ON auth_identity_accounts (tenant_key, workspace_key, user_id);

CREATE INDEX IF NOT EXISTS idx_auth_identity_accounts_tenant_email
  ON auth_identity_accounts (tenant_key, workspace_key, lower(provider_email))
  WHERE provider_email IS NOT NULL;

CREATE TABLE IF NOT EXISTS auth_mfa_factors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_key text NOT NULL,
  workspace_key text NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  factor_type text NOT NULL CHECK (factor_type IN ('totp', 'webauthn', 'recovery_code')),
  label text,
  secret_encrypted text,
  credential_id text,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  disabled_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_auth_mfa_factors_tenant_user_active
  ON auth_mfa_factors (tenant_key, workspace_key, user_id, factor_type)
  WHERE disabled_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_auth_mfa_factors_tenant_credential_unique
  ON auth_mfa_factors (tenant_key, workspace_key, user_id, factor_type, (COALESCE(credential_id, '')))
  WHERE disabled_at IS NULL;

ALTER TABLE auth_sessions
  ADD COLUMN IF NOT EXISTS auth_provider text NOT NULL DEFAULT 'password',
  ADD COLUMN IF NOT EXISTS user_agent_hash text,
  ADD COLUMN IF NOT EXISTS ip_hash text,
  ADD COLUMN IF NOT EXISTS revoked_at timestamptz,
  ADD COLUMN IF NOT EXISTS revoke_reason text;

CREATE INDEX IF NOT EXISTS idx_auth_sessions_tenant_user_active
  ON auth_sessions (tenant_key, workspace_key, user_id, expires_at DESC)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_auth_sessions_tenant_revoked
  ON auth_sessions (tenant_key, workspace_key, revoked_at DESC)
  WHERE revoked_at IS NOT NULL;
