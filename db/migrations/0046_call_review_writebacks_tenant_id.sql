-- 6esk v2: tenant-scope AI call review writeback idempotency.

ALTER TABLE call_review_writebacks
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);

UPDATE call_review_writebacks writeback
SET tenant_id = ticket.tenant_id
FROM tickets ticket
WHERE writeback.ticket_id = ticket.id
  AND writeback.tenant_id IS NULL;

ALTER TABLE call_review_writebacks
  ALTER COLUMN tenant_id SET NOT NULL;

DROP INDEX IF EXISTS uq_call_review_writebacks_session_idempotency;

CREATE UNIQUE INDEX IF NOT EXISTS uq_call_review_writebacks_tenant_session_idempotency
  ON call_review_writebacks(tenant_id, call_session_id, idempotency_key);

CREATE INDEX IF NOT EXISTS idx_call_review_writebacks_tenant_ticket_created
  ON call_review_writebacks(tenant_id, ticket_id, created_at DESC);
