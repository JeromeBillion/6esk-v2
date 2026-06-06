-- 6esk v2: tenant-id native auth security foundations.
-- Retains the useful wrong-folder MFA/session/security-policy work without
-- replacing the v2 tenant_id model.

CREATE TABLE IF NOT EXISTS tenant_security_policies (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  workspace_key text NOT NULL DEFAULT 'primary',
  allowed_login_domains text[] NOT NULL DEFAULT '{}',
  enforce_sso boolean NOT NULL DEFAULT false,
  require_mfa_for_admins boolean NOT NULL DEFAULT true,
  session_ttl_days integer NOT NULL DEFAULT 14 CHECK (session_ttl_days > 0 AND session_ttl_days <= 90),
  auth_provider text NOT NULL DEFAULT 'password' CHECK (auth_provider IN ('password', 'better_auth', 'oidc_broker')),
  oidc_issuer text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, workspace_key),
  FOREIGN KEY (tenant_id, workspace_key)
    REFERENCES workspaces(tenant_id, workspace_key)
    ON DELETE CASCADE
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'auth_sessions' AND column_name = 'auth_provider'
  ) THEN
    ALTER TABLE auth_sessions ADD COLUMN auth_provider text NOT NULL DEFAULT 'password';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'auth_sessions' AND column_name = 'user_agent_hash'
  ) THEN
    ALTER TABLE auth_sessions ADD COLUMN user_agent_hash text;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'auth_sessions' AND column_name = 'ip_hash'
  ) THEN
    ALTER TABLE auth_sessions ADD COLUMN ip_hash text;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'auth_sessions' AND column_name = 'revoked_at'
  ) THEN
    ALTER TABLE auth_sessions ADD COLUMN revoked_at timestamptz;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'auth_sessions' AND column_name = 'revoke_reason'
  ) THEN
    ALTER TABLE auth_sessions ADD COLUMN revoke_reason text;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_active
  ON auth_sessions (user_id, expires_at DESC)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_auth_sessions_revoked
  ON auth_sessions (revoked_at DESC)
  WHERE revoked_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS auth_mfa_factors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  workspace_key text NOT NULL DEFAULT 'primary',
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  factor_type text NOT NULL CHECK (factor_type IN ('totp', 'webauthn', 'recovery_code')),
  label text,
  secret_encrypted text,
  credential_id text,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  disabled_at timestamptz,
  FOREIGN KEY (tenant_id, workspace_key)
    REFERENCES workspaces(tenant_id, workspace_key)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_auth_mfa_factors_tenant_user_active
  ON auth_mfa_factors (tenant_id, workspace_key, user_id, factor_type)
  WHERE disabled_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_auth_mfa_factors_tenant_credential_unique
  ON auth_mfa_factors (tenant_id, workspace_key, user_id, factor_type, (COALESCE(credential_id, '')))
  WHERE disabled_at IS NULL;

CREATE TABLE IF NOT EXISTS auth_mfa_enrollments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  workspace_key text NOT NULL DEFAULT 'primary',
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  enrollment_hash text NOT NULL UNIQUE,
  secret_encrypted text NOT NULL,
  label text,
  expires_at timestamptz NOT NULL,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, workspace_key)
    REFERENCES workspaces(tenant_id, workspace_key)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_auth_mfa_enrollments_tenant_user_active
  ON auth_mfa_enrollments (tenant_id, workspace_key, user_id, expires_at DESC)
  WHERE verified_at IS NULL;

CREATE TABLE IF NOT EXISTS auth_mfa_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  workspace_key text NOT NULL DEFAULT 'primary',
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  challenge_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  attempt_count integer NOT NULL DEFAULT 0,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, workspace_key)
    REFERENCES workspaces(tenant_id, workspace_key)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_auth_mfa_challenges_tenant_user_active
  ON auth_mfa_challenges (tenant_id, workspace_key, user_id, expires_at DESC)
  WHERE used_at IS NULL;
