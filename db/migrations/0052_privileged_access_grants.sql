-- 6esk v2: tenant-id native privileged support access grants.
-- Impersonation must be backed by an approved, active grant.

CREATE TABLE IF NOT EXISTS privileged_access_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  workspace_key text NOT NULL DEFAULT 'primary',
  access_type text NOT NULL CHECK (access_type IN ('support', 'break_glass')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'revoked', 'expired', 'denied')),
  subject_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  subject_email text NOT NULL,
  subject_name text,
  requested_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  approved_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  revoked_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  reason text NOT NULL,
  reference text,
  approval_note text,
  revoke_reason text,
  requested_duration_minutes integer NOT NULL DEFAULT 60 CHECK (
    requested_duration_minutes > 0 AND requested_duration_minutes <= 480
  ),
  requested_at timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz,
  revoked_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  FOREIGN KEY (tenant_id, workspace_key)
    REFERENCES workspaces(tenant_id, workspace_key)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_privileged_access_grants_scope_status
  ON privileged_access_grants (tenant_id, workspace_key, status, expires_at DESC);

CREATE INDEX IF NOT EXISTS idx_privileged_access_grants_subject
  ON privileged_access_grants (tenant_id, workspace_key, lower(subject_email), status);

CREATE INDEX IF NOT EXISTS idx_privileged_access_grants_subject_user
  ON privileged_access_grants (tenant_id, workspace_key, subject_user_id, status)
  WHERE subject_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_privileged_access_grants_pending
  ON privileged_access_grants (tenant_id, workspace_key, requested_at DESC)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_privileged_access_grants_active
  ON privileged_access_grants (tenant_id, workspace_key, expires_at DESC)
  WHERE status = 'active';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'auth_sessions' AND column_name = 'privileged_access_grant_id'
  ) THEN
    ALTER TABLE auth_sessions
      ADD COLUMN privileged_access_grant_id uuid REFERENCES privileged_access_grants(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_auth_sessions_privileged_access_grant
  ON auth_sessions (privileged_access_grant_id)
  WHERE privileged_access_grant_id IS NOT NULL;
