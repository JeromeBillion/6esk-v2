-- 6esk v2: tenant-scoped billing lifecycle persistence.
-- Keeps subscriptions, adjustments, invoices, and collections state in Postgres
-- so usage estimates can reconcile to durable invoice records before provider wiring.

CREATE TABLE IF NOT EXISTS tenant_billing_accounts (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  workspace_key text NOT NULL DEFAULT 'primary',
  currency text NOT NULL DEFAULT 'ZAR',
  vat_rate_bps integer NOT NULL DEFAULT 0 CHECK (vat_rate_bps >= 0 AND vat_rate_bps <= 3000),
  payment_terms_days integer NOT NULL DEFAULT 7 CHECK (payment_terms_days >= 0 AND payment_terms_days <= 90),
  invoice_prefix text NOT NULL DEFAULT '6ESK-',
  next_invoice_sequence integer NOT NULL DEFAULT 1 CHECK (next_invoice_sequence > 0),
  billing_email text,
  collection_status text NOT NULL DEFAULT 'current'
    CHECK (collection_status IN ('current', 'past_due', 'collections', 'paused', 'written_off')),
  dunning_status text NOT NULL DEFAULT 'none'
    CHECK (dunning_status IN ('none', 'scheduled', 'active', 'paused', 'complete')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, workspace_key),
  FOREIGN KEY (tenant_id, workspace_key)
    REFERENCES workspaces(tenant_id, workspace_key)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tenant_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  workspace_key text NOT NULL DEFAULT 'primary',
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('trialing', 'active', 'past_due', 'paused', 'canceled')),
  plan_id text NOT NULL DEFAULT 'standard',
  billing_interval text NOT NULL DEFAULT 'month'
    CHECK (billing_interval IN ('month', 'year')),
  current_period_start timestamptz NOT NULL,
  current_period_end timestamptz NOT NULL,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  provider text,
  provider_subscription_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, workspace_key)
    REFERENCES tenant_billing_accounts(tenant_id, workspace_key)
    ON DELETE CASCADE,
  CHECK (current_period_end > current_period_start)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tenant_subscriptions_one_live
  ON tenant_subscriptions (tenant_id, workspace_key)
  WHERE status IN ('trialing', 'active', 'past_due', 'paused');

CREATE INDEX IF NOT EXISTS idx_tenant_subscriptions_tenant_status
  ON tenant_subscriptions (tenant_id, workspace_key, status, current_period_end DESC);

CREATE TABLE IF NOT EXISTS tenant_subscription_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id uuid NOT NULL REFERENCES tenant_subscriptions(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  workspace_key text NOT NULL DEFAULT 'primary',
  item_key text NOT NULL,
  item_kind text NOT NULL CHECK (item_kind IN ('base', 'module', 'addon', 'usage_commit')),
  module_key text,
  display_name text NOT NULL,
  quantity integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_amount_cent integer NOT NULL DEFAULT 0 CHECK (unit_amount_cent >= 0),
  currency text NOT NULL DEFAULT 'ZAR',
  pricing_source text NOT NULL DEFAULT 'catalog',
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_to timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, workspace_key)
    REFERENCES tenant_billing_accounts(tenant_id, workspace_key)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tenant_subscription_items_active
  ON tenant_subscription_items (tenant_id, workspace_key, subscription_id, item_key)
  WHERE effective_to IS NULL;

CREATE TABLE IF NOT EXISTS tenant_billing_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  workspace_key text NOT NULL DEFAULT 'primary',
  adjustment_type text NOT NULL CHECK (adjustment_type IN ('credit', 'refund', 'write_off', 'proration')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'applied', 'voided')),
  amount_cent integer NOT NULL CHECK (amount_cent <> 0),
  currency text NOT NULL DEFAULT 'ZAR',
  reason text NOT NULL,
  source_invoice_id uuid,
  applied_invoice_id uuid,
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  applied_at timestamptz,
  voided_at timestamptz,
  FOREIGN KEY (tenant_id, workspace_key)
    REFERENCES tenant_billing_accounts(tenant_id, workspace_key)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tenant_billing_adjustments_pending
  ON tenant_billing_adjustments (tenant_id, workspace_key, created_at)
  WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS tenant_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  workspace_key text NOT NULL DEFAULT 'primary',
  invoice_number text NOT NULL,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'open', 'paid', 'void', 'uncollectible')),
  currency text NOT NULL DEFAULT 'ZAR',
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  subscription_id uuid REFERENCES tenant_subscriptions(id) ON DELETE SET NULL,
  subtotal_cent integer NOT NULL DEFAULT 0,
  usage_cent integer NOT NULL DEFAULT 0,
  adjustment_cent integer NOT NULL DEFAULT 0,
  tax_cent integer NOT NULL DEFAULT 0,
  total_cent integer NOT NULL DEFAULT 0,
  amount_due_cent integer NOT NULL DEFAULT 0,
  due_at timestamptz,
  issued_at timestamptz,
  paid_at timestamptz,
  voided_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, workspace_key)
    REFERENCES tenant_billing_accounts(tenant_id, workspace_key)
    ON DELETE CASCADE,
  UNIQUE (tenant_id, invoice_number),
  CHECK (period_end > period_start)
);

CREATE INDEX IF NOT EXISTS idx_tenant_invoices_tenant_status
  ON tenant_invoices (tenant_id, workspace_key, status, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tenant_invoices_one_active_period
  ON tenant_invoices (tenant_id, workspace_key, period_start, period_end)
  WHERE status IN ('draft', 'open', 'paid', 'uncollectible');

CREATE TABLE IF NOT EXISTS tenant_invoice_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES tenant_invoices(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  workspace_key text NOT NULL DEFAULT 'primary',
  line_type text NOT NULL CHECK (line_type IN ('base', 'module', 'addon', 'usage', 'credit', 'refund', 'write_off', 'proration', 'tax')),
  module_key text,
  usage_kind text,
  description text NOT NULL,
  quantity numeric(14, 4) NOT NULL DEFAULT 1,
  unit_amount_cent integer NOT NULL DEFAULT 0,
  amount_cent integer NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'ZAR',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tenant_invoice_lines_invoice
  ON tenant_invoice_lines (invoice_id, line_type);

CREATE TABLE IF NOT EXISTS tenant_collection_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  workspace_key text NOT NULL DEFAULT 'primary',
  invoice_id uuid REFERENCES tenant_invoices(id) ON DELETE SET NULL,
  event_type text NOT NULL CHECK (
    event_type IN (
      'invoice_opened',
      'payment_attempted',
      'payment_failed',
      'reminder_sent',
      'dunning_started',
      'dunning_escalated',
      'collections_paused',
      'invoice_paid',
      'invoice_voided',
      'write_off_recorded'
    )
  ),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'succeeded', 'failed', 'canceled')),
  attempt_number integer NOT NULL DEFAULT 1 CHECK (attempt_number > 0),
  scheduled_at timestamptz,
  completed_at timestamptz,
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, workspace_key)
    REFERENCES tenant_billing_accounts(tenant_id, workspace_key)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tenant_collection_events_invoice
  ON tenant_collection_events (tenant_id, workspace_key, invoice_id, created_at DESC);
