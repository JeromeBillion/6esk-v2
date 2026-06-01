ALTER TABLE voice_operator_presence
  ADD COLUMN IF NOT EXISTS tenant_key text NOT NULL DEFAULT 'primary',
  ADD COLUMN IF NOT EXISTS workspace_key text NOT NULL DEFAULT 'primary';

UPDATE voice_operator_presence presence
SET tenant_key = u.tenant_key,
    workspace_key = u.workspace_key
FROM users u
WHERE u.id = presence.user_id
  AND (
    presence.tenant_key IS DISTINCT FROM u.tenant_key
    OR presence.workspace_key IS DISTINCT FROM u.workspace_key
  );

CREATE INDEX IF NOT EXISTS idx_voice_operator_presence_tenant_status_seen
  ON voice_operator_presence(tenant_key, workspace_key, status, last_seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_voice_operator_presence_tenant_active_call
  ON voice_operator_presence(tenant_key, workspace_key, active_call_session_id)
  WHERE active_call_session_id IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'voice_operator_presence_user_tenant_fkey'
  ) THEN
    ALTER TABLE voice_operator_presence
      ADD CONSTRAINT voice_operator_presence_user_tenant_fkey
      FOREIGN KEY (tenant_key, user_id) REFERENCES users(tenant_key, id)
      ON DELETE CASCADE;
  END IF;
END $$;
