ALTER TABLE agent_drafts
  ADD COLUMN IF NOT EXISTS tenant_key text NOT NULL DEFAULT 'primary',
  ADD COLUMN IF NOT EXISTS workspace_key text NOT NULL DEFAULT 'primary';

UPDATE agent_drafts draft
SET tenant_key = ticket.tenant_key,
    workspace_key = ticket.workspace_key
FROM tickets ticket
WHERE draft.ticket_id = ticket.id
  AND (
    draft.tenant_key IS DISTINCT FROM ticket.tenant_key
    OR draft.workspace_key IS DISTINCT FROM ticket.workspace_key
  );

CREATE INDEX IF NOT EXISTS idx_agent_drafts_tenant_ticket_status
  ON agent_drafts (tenant_key, workspace_key, ticket_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_drafts_tenant_integration_created
  ON agent_drafts (tenant_key, workspace_key, integration_id, created_at DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'agent_drafts_workspace_fkey'
  ) THEN
    ALTER TABLE agent_drafts
      ADD CONSTRAINT agent_drafts_workspace_fkey
      FOREIGN KEY (tenant_key, workspace_key) REFERENCES workspaces(tenant_key, workspace_key)
      ON DELETE RESTRICT;
  END IF;
END $$;
