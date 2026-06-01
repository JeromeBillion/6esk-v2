ALTER TABLE call_review_writebacks
  ADD COLUMN IF NOT EXISTS tenant_key text NOT NULL DEFAULT 'primary',
  ADD COLUMN IF NOT EXISTS workspace_key text NOT NULL DEFAULT 'primary';

UPDATE call_review_writebacks writeback
SET tenant_key = session.tenant_key,
    workspace_key = session.workspace_key
FROM call_sessions session
WHERE writeback.call_session_id = session.id
  AND (
    writeback.tenant_key IS DISTINCT FROM session.tenant_key
    OR writeback.workspace_key IS DISTINCT FROM session.workspace_key
  );

CREATE INDEX IF NOT EXISTS idx_call_review_writebacks_tenant_ticket_created
  ON call_review_writebacks (tenant_key, workspace_key, ticket_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_call_review_writebacks_tenant_session_idempotency
  ON call_review_writebacks (tenant_key, workspace_key, call_session_id, idempotency_key);
