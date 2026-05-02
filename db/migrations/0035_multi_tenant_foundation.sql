-- 6esk v2: Multi-tenant foundation
-- Introduces tenant, organization, and workspace as first-class entities.
--
-- Hierarchy:
--   tenant (commercial/legal/billing boundary)
--     └─ organization (customer-company identity)
--     └─ workspace (operational config, users, queues, channels, modules)

-- ---------------------------------------------------------------------------
-- Lifecycle enum
-- ---------------------------------------------------------------------------
CREATE TYPE tenant_status AS ENUM ('active', 'suspended', 'closed');

-- ---------------------------------------------------------------------------
-- Tenants
-- ---------------------------------------------------------------------------
CREATE TABLE tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  display_name text NOT NULL,
  status tenant_status NOT NULL DEFAULT 'active',
  plan text NOT NULL DEFAULT 'starter',
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_tenants_slug ON tenants(slug);
CREATE INDEX idx_tenants_status ON tenants(status);

-- ---------------------------------------------------------------------------
-- Organizations
-- ---------------------------------------------------------------------------
CREATE TABLE organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  domain text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_organizations_tenant_id ON organizations(tenant_id);
CREATE INDEX idx_organizations_domain ON organizations(domain) WHERE domain IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Workspaces
-- ---------------------------------------------------------------------------
CREATE TABLE workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  workspace_key text NOT NULL,
  display_name text NOT NULL DEFAULT '6esk Workspace',
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, workspace_key)
);

CREATE INDEX idx_workspaces_tenant_id ON workspaces(tenant_id);

-- ---------------------------------------------------------------------------
-- Tenant entitlements (module-level on/off per tenant)
-- ---------------------------------------------------------------------------
CREATE TABLE tenant_entitlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  module_key text NOT NULL,
  is_enabled boolean NOT NULL DEFAULT false,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  granted_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, module_key)
);

CREATE INDEX idx_tenant_entitlements_tenant_id ON tenant_entitlements(tenant_id);

-- ---------------------------------------------------------------------------
-- Seed a default tenant for v1 data migration
-- ---------------------------------------------------------------------------
INSERT INTO tenants (id, slug, display_name, status, plan)
VALUES ('00000000-0000-0000-0000-000000000001', 'default', '6esk Default Tenant', 'active', 'enterprise')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO workspaces (tenant_id, workspace_key, display_name)
VALUES ('00000000-0000-0000-0000-000000000001', 'primary', '6esk Primary Workspace')
ON CONFLICT (tenant_id, workspace_key) DO NOTHING;

-- Seed default entitlements for the default tenant (all modules enabled)
INSERT INTO tenant_entitlements (tenant_id, module_key, is_enabled) VALUES
  ('00000000-0000-0000-0000-000000000001', 'email', true),
  ('00000000-0000-0000-0000-000000000001', 'whatsapp', true),
  ('00000000-0000-0000-0000-000000000001', 'voice', true),
  ('00000000-0000-0000-0000-000000000001', 'aiAutomation', true),
  ('00000000-0000-0000-0000-000000000001', 'dexterOrchestration', true),
  ('00000000-0000-0000-0000-000000000001', 'vanillaWebchat', true)
ON CONFLICT (tenant_id, module_key) DO NOTHING;
