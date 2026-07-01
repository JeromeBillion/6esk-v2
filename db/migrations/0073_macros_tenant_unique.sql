-- 6esk v2: macro titles are tenant-owned support configuration, not global state.

ALTER TABLE macros
  DROP CONSTRAINT IF EXISTS macros_title_key;

CREATE UNIQUE INDEX IF NOT EXISTS uq_macros_tenant_title
  ON macros(tenant_id, title);
