-- 6esk v2: tenant-owned support tag catalog and ticket tag links.
-- Existing global tags are assigned to the default tenant for continuity.

ALTER TABLE tags
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE;

UPDATE tags
SET tenant_id = '00000000-0000-0000-0000-000000000001'
WHERE tenant_id IS NULL;

ALTER TABLE tags
  ALTER COLUMN tenant_id SET NOT NULL;

ALTER TABLE tags
  DROP CONSTRAINT IF EXISTS tags_name_key;

CREATE UNIQUE INDEX IF NOT EXISTS uq_tags_tenant_name
  ON tags(tenant_id, name);

CREATE UNIQUE INDEX IF NOT EXISTS uq_tags_tenant_id_id
  ON tags(tenant_id, id);

CREATE INDEX IF NOT EXISTS idx_tags_tenant_id
  ON tags(tenant_id);

ALTER TABLE ticket_tags
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE;

UPDATE ticket_tags tt
SET tenant_id = t.tenant_id
FROM tickets t
WHERE tt.ticket_id = t.id
  AND tt.tenant_id IS NULL;

ALTER TABLE ticket_tags
  ALTER COLUMN tenant_id SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_tickets_tenant_id_id
  ON tickets(tenant_id, id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_ticket_tags_tenant_ticket_tag
  ON ticket_tags(tenant_id, ticket_id, tag_id);

CREATE INDEX IF NOT EXISTS idx_ticket_tags_tenant_ticket
  ON ticket_tags(tenant_id, ticket_id);

CREATE INDEX IF NOT EXISTS idx_ticket_tags_tenant_tag
  ON ticket_tags(tenant_id, tag_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ticket_tags_tenant_ticket_fkey'
  ) THEN
    ALTER TABLE ticket_tags
      ADD CONSTRAINT ticket_tags_tenant_ticket_fkey
      FOREIGN KEY (tenant_id, ticket_id)
      REFERENCES tickets(tenant_id, id)
      ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ticket_tags_tenant_tag_fkey'
  ) THEN
    ALTER TABLE ticket_tags
      ADD CONSTRAINT ticket_tags_tenant_tag_fkey
      FOREIGN KEY (tenant_id, tag_id)
      REFERENCES tags(tenant_id, id)
      ON DELETE CASCADE;
  END IF;
END $$;
