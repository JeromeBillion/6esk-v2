CREATE TABLE IF NOT EXISTS auth_mfa_enrollments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_key text NOT NULL,
  workspace_key text NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  enrollment_hash text NOT NULL UNIQUE,
  secret_encrypted text NOT NULL,
  label text,
  expires_at timestamptz NOT NULL,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_auth_mfa_enrollments_tenant_user_active
  ON auth_mfa_enrollments (tenant_key, workspace_key, user_id, expires_at DESC)
  WHERE verified_at IS NULL;

CREATE TABLE IF NOT EXISTS auth_mfa_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_key text NOT NULL,
  workspace_key text NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  challenge_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  attempt_count integer NOT NULL DEFAULT 0,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_auth_mfa_challenges_tenant_user_active
  ON auth_mfa_challenges (tenant_key, workspace_key, user_id, expires_at DESC)
  WHERE used_at IS NULL;
