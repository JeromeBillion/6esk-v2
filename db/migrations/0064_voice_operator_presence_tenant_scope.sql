-- 6esk v2: tenant-own voice operator live presence.

ALTER TABLE voice_operator_presence
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE;

UPDATE voice_operator_presence presence
SET tenant_id = COALESCE(u.tenant_id, '00000000-0000-0000-0000-000000000001')
FROM users u
WHERE presence.user_id = u.id
  AND presence.tenant_id IS NULL;

UPDATE voice_operator_presence
SET tenant_id = '00000000-0000-0000-0000-000000000001'
WHERE tenant_id IS NULL;

ALTER TABLE voice_operator_presence
  ALTER COLUMN tenant_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_voice_operator_presence_tenant_status_seen
  ON voice_operator_presence(tenant_id, status, last_seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_voice_operator_presence_tenant_active_call
  ON voice_operator_presence(tenant_id, active_call_session_id)
  WHERE active_call_session_id IS NOT NULL;
