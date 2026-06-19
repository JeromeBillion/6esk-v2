ALTER TABLE ticket_links
  ADD COLUMN IF NOT EXISTS tenant_id uuid;

UPDATE ticket_links links
SET tenant_id = source_ticket.tenant_id
FROM tickets source_ticket
WHERE source_ticket.id = links.source_ticket_id
  AND EXISTS (
    SELECT 1
    FROM tickets target_ticket
    WHERE target_ticket.id = links.target_ticket_id
      AND target_ticket.tenant_id = source_ticket.tenant_id
  )
  AND links.tenant_id IS NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM ticket_links WHERE tenant_id IS NULL) THEN
    RAISE EXCEPTION 'ticket_links tenant_id backfill requires both tickets to belong to the same tenant';
  END IF;
END $$;

ALTER TABLE ticket_links
  ALTER COLUMN tenant_id SET NOT NULL;

ALTER TABLE ticket_links
  ADD CONSTRAINT ticket_links_tenant_id_fkey
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

DROP INDEX IF EXISTS idx_ticket_links_pair_relationship;
DROP INDEX IF EXISTS idx_ticket_links_source_ticket;
DROP INDEX IF EXISTS idx_ticket_links_target_ticket;

CREATE UNIQUE INDEX IF NOT EXISTS idx_ticket_links_tenant_pair_relationship
  ON ticket_links (
    tenant_id,
    LEAST(source_ticket_id, target_ticket_id),
    GREATEST(source_ticket_id, target_ticket_id),
    relationship_type
  );

CREATE INDEX IF NOT EXISTS idx_ticket_links_tenant_source_ticket
  ON ticket_links (tenant_id, source_ticket_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ticket_links_tenant_target_ticket
  ON ticket_links (tenant_id, target_ticket_id, created_at DESC);
