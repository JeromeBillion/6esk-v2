-- 6esk v2: Add impersonation tracking to auth sessions for break-glass support

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'auth_sessions' AND column_name = 'impersonated_tenant_id') THEN
    ALTER TABLE auth_sessions ADD COLUMN impersonated_tenant_id uuid REFERENCES tenants(id) ON DELETE SET NULL;
  END IF;
END $$;
