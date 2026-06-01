CREATE TABLE IF NOT EXISTS call_provider_numbers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_key text NOT NULL DEFAULT 'primary',
  workspace_key text NOT NULL DEFAULT 'primary',
  provider text NOT NULL DEFAULT 'twilio',
  phone_number text NOT NULL,
  account_sid text,
  status text NOT NULL DEFAULT 'active',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_call_provider_numbers_active_phone
  ON call_provider_numbers (provider, phone_number)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_call_provider_numbers_account
  ON call_provider_numbers (provider, account_sid)
  WHERE account_sid IS NOT NULL AND status = 'active';

CREATE INDEX IF NOT EXISTS idx_call_provider_numbers_tenant_status
  ON call_provider_numbers (tenant_key, workspace_key, status);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'call_provider_numbers_workspace_fkey'
  ) THEN
    ALTER TABLE call_provider_numbers
      ADD CONSTRAINT call_provider_numbers_workspace_fkey
      FOREIGN KEY (tenant_key, workspace_key) REFERENCES workspaces(tenant_key, workspace_key)
      ON DELETE CASCADE;
  END IF;
END $$;
