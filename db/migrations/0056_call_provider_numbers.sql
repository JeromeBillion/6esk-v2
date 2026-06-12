-- 6esk v2: tenant-owned provider phone/account routing for inbound calls.
-- This is the v2-native tenant_id version of the wrong-folder call_provider_numbers work.

CREATE TABLE IF NOT EXISTS call_provider_numbers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  workspace_key text NOT NULL DEFAULT 'primary',
  provider text NOT NULL DEFAULT 'twilio',
  phone_number text NOT NULL,
  account_sid text,
  status text NOT NULL DEFAULT 'active',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT call_provider_numbers_status_check
    CHECK (status IN ('active', 'paused', 'inactive')),
  CONSTRAINT call_provider_numbers_workspace_fkey
    FOREIGN KEY (tenant_id, workspace_key)
    REFERENCES workspaces(tenant_id, workspace_key)
    ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_call_provider_numbers_active_phone
  ON call_provider_numbers (provider, phone_number)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_call_provider_numbers_account
  ON call_provider_numbers (provider, account_sid)
  WHERE account_sid IS NOT NULL AND status = 'active';

CREATE INDEX IF NOT EXISTS idx_call_provider_numbers_tenant_status
  ON call_provider_numbers (tenant_id, workspace_key, status);
