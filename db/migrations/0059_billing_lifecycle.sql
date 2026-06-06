INSERT INTO roles (name, description)
VALUES (
  'finance_admin',
  'Can manage workspace billing, invoices, collections, and finance exports.'
)
ON CONFLICT (name) DO UPDATE SET description = EXCLUDED.description;

CREATE TABLE IF NOT EXISTS workspace_billing_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_key text NOT NULL,
  workspace_key text NOT NULL,
  plan_key text NOT NULL DEFAULT 'core_os',
  catalog_version text NOT NULL DEFAULT 'v2.2026-06',
  status text NOT NULL DEFAULT 'active' CHECK (
    status IN ('trialing', 'active', 'past_due', 'grace_period', 'downgrade_pending', 'suspended', 'canceled', 'written_off')
  ),
  collection_status text NOT NULL DEFAULT 'current' CHECK (
    collection_status IN ('current', 'retrying', 'grace_period', 'overdue', 'suspended', 'restored', 'written_off')
  ),
  modules jsonb NOT NULL DEFAULT '{}'::jsonb,
  current_period_start timestamptz NOT NULL,
  current_period_end timestamptz NOT NULL,
  renews_at timestamptz,
  cancel_at timestamptz,
  canceled_at timestamptz,
  downgrade_at timestamptz,
  suspended_at timestamptz,
  grace_period_ends_at timestamptz,
  provider_customer_ref text,
  provider_subscription_ref text,
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (current_period_end > current_period_start),
  UNIQUE (tenant_key, workspace_key),
  FOREIGN KEY (tenant_key, workspace_key)
    REFERENCES workspaces(tenant_key, workspace_key) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS workspace_billing_plan_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_key text NOT NULL,
  workspace_key text NOT NULL,
  subscription_id uuid NOT NULL REFERENCES workspace_billing_subscriptions(id) ON DELETE RESTRICT,
  change_type text NOT NULL CHECK (
    change_type IN ('upgrade', 'downgrade', 'module_change', 'cancel', 'reactivate')
  ),
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'applied', 'canceled')),
  from_plan_key text NOT NULL,
  to_plan_key text NOT NULL,
  from_modules jsonb NOT NULL DEFAULT '{}'::jsonb,
  to_modules jsonb NOT NULL DEFAULT '{}'::jsonb,
  effective_at timestamptz NOT NULL,
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  subtotal_delta_cents integer NOT NULL DEFAULT 0,
  vat_delta_cents integer NOT NULL DEFAULT 0,
  total_delta_cents integer NOT NULL DEFAULT 0,
  proration_cents integer NOT NULL DEFAULT 0,
  credit_cents integer NOT NULL DEFAULT 0 CHECK (credit_cents >= 0),
  charge_cents integer NOT NULL DEFAULT 0 CHECK (charge_cents >= 0),
  currency text NOT NULL DEFAULT 'ZAR',
  calculation jsonb NOT NULL DEFAULT '{}'::jsonb,
  requested_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  applied_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (period_end > period_start),
  FOREIGN KEY (tenant_key, workspace_key)
    REFERENCES workspaces(tenant_key, workspace_key) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS workspace_billing_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_key text NOT NULL,
  workspace_key text NOT NULL,
  subscription_id uuid NOT NULL REFERENCES workspace_billing_subscriptions(id) ON DELETE RESTRICT,
  invoice_number text,
  status text NOT NULL DEFAULT 'draft' CHECK (
    status IN ('draft', 'issued', 'paid', 'void', 'credited', 'refunded', 'overdue', 'written_off')
  ),
  currency text NOT NULL DEFAULT 'ZAR',
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  due_at timestamptz,
  issued_at timestamptz,
  paid_at timestamptz,
  voided_at timestamptz,
  credited_at timestamptz,
  refunded_at timestamptz,
  written_off_at timestamptz,
  subtotal_cents integer NOT NULL DEFAULT 0,
  vat_cents integer NOT NULL DEFAULT 0,
  total_cents integer NOT NULL DEFAULT 0,
  amount_due_cents integer NOT NULL DEFAULT 0,
  amount_paid_cents integer NOT NULL DEFAULT 0,
  amount_credited_cents integer NOT NULL DEFAULT 0,
  amount_refunded_cents integer NOT NULL DEFAULT 0,
  amount_written_off_cents integer NOT NULL DEFAULT 0,
  lines jsonb NOT NULL DEFAULT '[]'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (period_end > period_start),
  CHECK (subtotal_cents >= 0),
  CHECK (vat_cents >= 0),
  CHECK (total_cents >= 0),
  CHECK (amount_due_cents >= 0),
  CHECK (amount_paid_cents >= 0),
  CHECK (amount_credited_cents >= 0),
  CHECK (amount_refunded_cents >= 0),
  CHECK (amount_written_off_cents >= 0),
  FOREIGN KEY (tenant_key, workspace_key)
    REFERENCES workspaces(tenant_key, workspace_key) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS workspace_billing_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_key text NOT NULL,
  workspace_key text NOT NULL,
  subscription_id uuid NOT NULL REFERENCES workspace_billing_subscriptions(id) ON DELETE RESTRICT,
  invoice_id uuid REFERENCES workspace_billing_invoices(id) ON DELETE SET NULL,
  adjustment_type text NOT NULL CHECK (
    adjustment_type IN ('credit', 'refund', 'write_off', 'plan_override')
  ),
  status text NOT NULL DEFAULT 'applied' CHECK (status IN ('applied', 'void')),
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  currency text NOT NULL DEFAULT 'ZAR',
  reason text NOT NULL,
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  voided_at timestamptz,
  FOREIGN KEY (tenant_key, workspace_key)
    REFERENCES workspaces(tenant_key, workspace_key) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS workspace_billing_dunning_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_key text NOT NULL,
  workspace_key text NOT NULL,
  subscription_id uuid NOT NULL REFERENCES workspace_billing_subscriptions(id) ON DELETE RESTRICT,
  invoice_id uuid REFERENCES workspace_billing_invoices(id) ON DELETE SET NULL,
  event_type text NOT NULL CHECK (
    event_type IN ('retry_scheduled', 'grace_period_started', 'overdue', 'suspended', 'restored', 'written_off')
  ),
  from_collection_status text,
  to_collection_status text NOT NULL CHECK (
    to_collection_status IN ('current', 'retrying', 'grace_period', 'overdue', 'suspended', 'restored', 'written_off')
  ),
  reason text,
  retry_at timestamptz,
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_key, workspace_key)
    REFERENCES workspaces(tenant_key, workspace_key) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_workspace_billing_subscriptions_scope_status
  ON workspace_billing_subscriptions (tenant_key, workspace_key, status, collection_status);

CREATE INDEX IF NOT EXISTS idx_workspace_billing_plan_changes_scope_created
  ON workspace_billing_plan_changes (tenant_key, workspace_key, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_workspace_billing_invoices_scope_status
  ON workspace_billing_invoices (tenant_key, workspace_key, status, due_at DESC NULLS LAST);

CREATE UNIQUE INDEX IF NOT EXISTS idx_workspace_billing_invoices_number
  ON workspace_billing_invoices (tenant_key, workspace_key, invoice_number)
  WHERE invoice_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_workspace_billing_adjustments_scope_created
  ON workspace_billing_adjustments (tenant_key, workspace_key, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_workspace_billing_dunning_scope_created
  ON workspace_billing_dunning_events (tenant_key, workspace_key, created_at DESC);
