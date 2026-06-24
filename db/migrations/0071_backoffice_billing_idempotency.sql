-- 6esk v2: idempotency ledger for sensitive backoffice billing mutations.
--
-- Backoffice finance actions can be retried by browsers, operators, or network
-- clients. This ledger makes duplicate requests recoverable while preserving
-- tenant scope and committing the idempotency result with the billing mutation.

CREATE TABLE IF NOT EXISTS tenant_billing_action_idempotency (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  workspace_key text NOT NULL DEFAULT 'primary',
  idempotency_key text NOT NULL,
  action_type text NOT NULL,
  request_hash text NOT NULL,
  status text NOT NULL DEFAULT 'processing'
    CHECK (status IN ('processing', 'completed')),
  response jsonb,
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, workspace_key)
    REFERENCES tenant_billing_accounts(tenant_id, workspace_key)
    ON DELETE CASCADE,
  CHECK (length(trim(idempotency_key)) >= 8),
  CHECK (length(trim(action_type)) > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_tenant_billing_action_idempotency_key
  ON tenant_billing_action_idempotency (tenant_id, workspace_key, idempotency_key);

CREATE INDEX IF NOT EXISTS idx_tenant_billing_action_idempotency_recent
  ON tenant_billing_action_idempotency (tenant_id, workspace_key, created_at DESC);
