ALTER TABLE external_user_links
  ADD COLUMN IF NOT EXISTS tenant_id uuid;

UPDATE external_user_links links
SET tenant_id = tickets.tenant_id
FROM tickets
WHERE links.last_ticket_id = tickets.id
  AND links.tenant_id IS NULL;

UPDATE external_user_links links
SET tenant_id = single_tenant.id
FROM (
  SELECT MIN(id) AS id, COUNT(*) AS tenant_count
  FROM tenants
) single_tenant
WHERE links.tenant_id IS NULL
  AND single_tenant.tenant_count = 1;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM external_user_links WHERE tenant_id IS NULL) THEN
    RAISE EXCEPTION 'external_user_links tenant_id backfill requires ticket evidence or a single-tenant database';
  END IF;
END $$;

ALTER TABLE external_user_links
  ALTER COLUMN tenant_id SET NOT NULL;

ALTER TABLE external_user_links
  ADD CONSTRAINT external_user_links_tenant_id_fkey
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE external_user_links
  DROP CONSTRAINT IF EXISTS external_user_links_external_system_external_user_id_key;

DROP INDEX IF EXISTS idx_external_user_links_email;
DROP INDEX IF EXISTS idx_external_user_links_phone;
DROP INDEX IF EXISTS idx_external_user_links_last_seen_at;

CREATE UNIQUE INDEX IF NOT EXISTS idx_external_user_links_tenant_system_user
  ON external_user_links (tenant_id, external_system, external_user_id);

CREATE INDEX IF NOT EXISTS idx_external_user_links_tenant_email
  ON external_user_links (tenant_id, external_system, LOWER(email))
  WHERE email IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_external_user_links_tenant_phone
  ON external_user_links (tenant_id, external_system, phone)
  WHERE phone IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_external_user_links_tenant_last_seen_at
  ON external_user_links (tenant_id, last_seen_at DESC);
