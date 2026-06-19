-- 6esk v2: tenant-own support config and password reset state.

ALTER TABLE macros
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE;

UPDATE macros
SET tenant_id = '00000000-0000-0000-0000-000000000001'
WHERE tenant_id IS NULL;

ALTER TABLE macros
  ALTER COLUMN tenant_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_macros_tenant_active_title
  ON macros(tenant_id, is_active, title);

ALTER TABLE support_saved_views
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE;

UPDATE support_saved_views sv
SET tenant_id = COALESCE(u.tenant_id, '00000000-0000-0000-0000-000000000001')
FROM users u
WHERE sv.user_id = u.id
  AND sv.tenant_id IS NULL;

UPDATE support_saved_views
SET tenant_id = '00000000-0000-0000-0000-000000000001'
WHERE tenant_id IS NULL;

ALTER TABLE support_saved_views
  ALTER COLUMN tenant_id SET NOT NULL;

DROP INDEX IF EXISTS uq_support_saved_views_user_name;

CREATE UNIQUE INDEX IF NOT EXISTS uq_support_saved_views_tenant_user_name
  ON support_saved_views(tenant_id, user_id, lower(name));

CREATE INDEX IF NOT EXISTS idx_support_saved_views_tenant_user_updated
  ON support_saved_views(tenant_id, user_id, updated_at DESC);

ALTER TABLE password_resets
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE;

UPDATE password_resets pr
SET tenant_id = COALESCE(u.tenant_id, '00000000-0000-0000-0000-000000000001')
FROM users u
WHERE pr.user_id = u.id
  AND pr.tenant_id IS NULL;

UPDATE password_resets
SET tenant_id = '00000000-0000-0000-0000-000000000001'
WHERE tenant_id IS NULL;

ALTER TABLE password_resets
  ALTER COLUMN tenant_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_password_resets_tenant_token_created
  ON password_resets(tenant_id, token_hash, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_password_resets_tenant_user_created
  ON password_resets(tenant_id, user_id, created_at DESC);
