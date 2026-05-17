DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'auth_sessions'
      AND column_name = 'impersonation_reason'
  ) THEN
    ALTER TABLE auth_sessions ADD COLUMN impersonation_reason text;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'auth_sessions'
      AND column_name = 'impersonation_ticket_ref'
  ) THEN
    ALTER TABLE auth_sessions ADD COLUMN impersonation_ticket_ref text;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'auth_sessions'
      AND column_name = 'impersonation_started_at'
  ) THEN
    ALTER TABLE auth_sessions ADD COLUMN impersonation_started_at timestamptz;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'auth_sessions'
      AND column_name = 'impersonation_expires_at'
  ) THEN
    ALTER TABLE auth_sessions ADD COLUMN impersonation_expires_at timestamptz;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_auth_sessions_impersonation_expires_at
  ON auth_sessions (impersonation_expires_at)
  WHERE impersonated_tenant_id IS NOT NULL;
