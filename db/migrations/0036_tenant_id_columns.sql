-- 6esk v2: Add tenant_id to all existing customer-data tables.
--
-- Strategy:
--   1. Add tenant_id as NULLABLE with FK to tenants(id)
--   2. Backfill all existing rows with the default tenant
--   3. Set NOT NULL constraint
--   4. Add composite indexes for tenant-scoped lookups
--
-- This migration is safe to run on a live v1 database.

DO $$ BEGIN
  -- Default tenant ID (seeded in 0035)
  -- All existing v1 data belongs to the default tenant.

  -- -----------------------------------------------------------------------
  -- Core tables
  -- -----------------------------------------------------------------------
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'tenant_id') THEN
    ALTER TABLE users ADD COLUMN tenant_id uuid REFERENCES tenants(id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'roles' AND column_name = 'tenant_id') THEN
    ALTER TABLE roles ADD COLUMN tenant_id uuid REFERENCES tenants(id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'mailboxes' AND column_name = 'tenant_id') THEN
    ALTER TABLE mailboxes ADD COLUMN tenant_id uuid REFERENCES tenants(id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'messages' AND column_name = 'tenant_id') THEN
    ALTER TABLE messages ADD COLUMN tenant_id uuid REFERENCES tenants(id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'attachments' AND column_name = 'tenant_id') THEN
    ALTER TABLE attachments ADD COLUMN tenant_id uuid REFERENCES tenants(id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tickets' AND column_name = 'tenant_id') THEN
    ALTER TABLE tickets ADD COLUMN tenant_id uuid REFERENCES tenants(id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ticket_events' AND column_name = 'tenant_id') THEN
    ALTER TABLE ticket_events ADD COLUMN tenant_id uuid REFERENCES tenants(id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'replies' AND column_name = 'tenant_id') THEN
    ALTER TABLE replies ADD COLUMN tenant_id uuid REFERENCES tenants(id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'sla_configs' AND column_name = 'tenant_id') THEN
    ALTER TABLE sla_configs ADD COLUMN tenant_id uuid REFERENCES tenants(id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'csat_ratings' AND column_name = 'tenant_id') THEN
    ALTER TABLE csat_ratings ADD COLUMN tenant_id uuid REFERENCES tenants(id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'audit_logs' AND column_name = 'tenant_id') THEN
    ALTER TABLE audit_logs ADD COLUMN tenant_id uuid REFERENCES tenants(id);
  END IF;

  -- -----------------------------------------------------------------------
  -- WhatsApp tables
  -- -----------------------------------------------------------------------
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'whatsapp_accounts' AND column_name = 'tenant_id') THEN
    ALTER TABLE whatsapp_accounts ADD COLUMN tenant_id uuid REFERENCES tenants(id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'whatsapp_events' AND column_name = 'tenant_id') THEN
    ALTER TABLE whatsapp_events ADD COLUMN tenant_id uuid REFERENCES tenants(id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'whatsapp_templates' AND column_name = 'tenant_id') THEN
    ALTER TABLE whatsapp_templates ADD COLUMN tenant_id uuid REFERENCES tenants(id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'whatsapp_status_events' AND column_name = 'tenant_id') THEN
    ALTER TABLE whatsapp_status_events ADD COLUMN tenant_id uuid REFERENCES tenants(id);
  END IF;

  -- -----------------------------------------------------------------------
  -- Agent / AI tables
  -- -----------------------------------------------------------------------
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'agent_integrations' AND column_name = 'tenant_id') THEN
    ALTER TABLE agent_integrations ADD COLUMN tenant_id uuid REFERENCES tenants(id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'agent_outbox' AND column_name = 'tenant_id') THEN
    ALTER TABLE agent_outbox ADD COLUMN tenant_id uuid REFERENCES tenants(id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'agent_drafts' AND column_name = 'tenant_id') THEN
    ALTER TABLE agent_drafts ADD COLUMN tenant_id uuid REFERENCES tenants(id);
  END IF;

  -- -----------------------------------------------------------------------
  -- Customer tables
  -- -----------------------------------------------------------------------
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'customers' AND column_name = 'tenant_id') THEN
    ALTER TABLE customers ADD COLUMN tenant_id uuid REFERENCES tenants(id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'customer_identities' AND column_name = 'tenant_id') THEN
    ALTER TABLE customer_identities ADD COLUMN tenant_id uuid REFERENCES tenants(id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'customer_merges' AND column_name = 'tenant_id') THEN
    ALTER TABLE customer_merges ADD COLUMN tenant_id uuid REFERENCES tenants(id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ticket_merges' AND column_name = 'tenant_id') THEN
    ALTER TABLE ticket_merges ADD COLUMN tenant_id uuid REFERENCES tenants(id);
  END IF;

  -- -----------------------------------------------------------------------
  -- Workspace & metering tables
  -- -----------------------------------------------------------------------
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'workspace_modules' AND column_name = 'tenant_id') THEN
    ALTER TABLE workspace_modules ADD COLUMN tenant_id uuid REFERENCES tenants(id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'workspace_module_usage_events' AND column_name = 'tenant_id') THEN
    ALTER TABLE workspace_module_usage_events ADD COLUMN tenant_id uuid REFERENCES tenants(id);
  END IF;

END $$;

-- ---------------------------------------------------------------------------
-- Backfill all existing rows with the default tenant
-- ---------------------------------------------------------------------------
UPDATE users SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
UPDATE roles SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
UPDATE mailboxes SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
UPDATE messages SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
UPDATE attachments SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
UPDATE tickets SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
UPDATE ticket_events SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
UPDATE replies SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
UPDATE sla_configs SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
UPDATE csat_ratings SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
UPDATE audit_logs SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
UPDATE whatsapp_accounts SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
UPDATE whatsapp_events SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
UPDATE whatsapp_templates SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
UPDATE whatsapp_status_events SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
UPDATE agent_integrations SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
UPDATE agent_outbox SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
UPDATE agent_drafts SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
UPDATE customers SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
UPDATE customer_identities SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
UPDATE customer_merges SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
UPDATE ticket_merges SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
UPDATE workspace_modules SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
UPDATE workspace_module_usage_events SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;

-- ---------------------------------------------------------------------------
-- Enforce NOT NULL after backfill
-- ---------------------------------------------------------------------------
ALTER TABLE users ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE roles ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE mailboxes ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE messages ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE attachments ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE tickets ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE ticket_events ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE replies ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE sla_configs ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE csat_ratings ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE audit_logs ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE whatsapp_accounts ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE whatsapp_events ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE whatsapp_templates ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE whatsapp_status_events ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE agent_integrations ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE agent_outbox ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE agent_drafts ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE customers ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE customer_identities ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE customer_merges ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE ticket_merges ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE workspace_modules ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE workspace_module_usage_events ALTER COLUMN tenant_id SET NOT NULL;

-- ---------------------------------------------------------------------------
-- Composite indexes for tenant-scoped queries
-- ---------------------------------------------------------------------------
CREATE INDEX idx_users_tenant_id ON users(tenant_id);
CREATE INDEX idx_roles_tenant_id ON roles(tenant_id);
CREATE INDEX idx_mailboxes_tenant_id ON mailboxes(tenant_id);
CREATE INDEX idx_messages_tenant_id ON messages(tenant_id);
CREATE INDEX idx_tickets_tenant_id ON tickets(tenant_id);
CREATE INDEX idx_ticket_events_tenant_id ON ticket_events(tenant_id);
CREATE INDEX idx_audit_logs_tenant_id ON audit_logs(tenant_id);
CREATE INDEX idx_customers_tenant_id ON customers(tenant_id);
CREATE INDEX idx_agent_integrations_tenant_id ON agent_integrations(tenant_id);
CREATE INDEX idx_workspace_modules_tenant_id ON workspace_modules(tenant_id);
CREATE INDEX idx_workspace_module_usage_events_tenant_id ON workspace_module_usage_events(tenant_id);
