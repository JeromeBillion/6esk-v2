CREATE TABLE IF NOT EXISTS privileged_access_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_key text NOT NULL,
  workspace_key text NOT NULL,
  access_type text NOT NULL CHECK (access_type IN ('support', 'break_glass')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'revoked', 'expired', 'denied')),
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
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_privileged_access_grants_scope_status
  ON privileged_access_grants (tenant_key, workspace_key, status, expires_at DESC);

CREATE INDEX IF NOT EXISTS idx_privileged_access_grants_subject
  ON privileged_access_grants (tenant_key, workspace_key, lower(subject_email), status);

CREATE INDEX IF NOT EXISTS idx_privileged_access_grants_pending
  ON privileged_access_grants (tenant_key, workspace_key, requested_at DESC)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_privileged_access_grants_active
  ON privileged_access_grants (tenant_key, workspace_key, expires_at DESC)
  WHERE status = 'active';
