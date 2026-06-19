-- 6esk v2: tenant-own voice consent history.

ALTER TABLE voice_consent_events
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE;

UPDATE voice_consent_events vce
SET tenant_id = COALESCE(c.tenant_id, '00000000-0000-0000-0000-000000000001')
FROM customers c
WHERE vce.customer_id = c.id
  AND vce.tenant_id IS NULL;

UPDATE voice_consent_events
SET tenant_id = '00000000-0000-0000-0000-000000000001'
WHERE tenant_id IS NULL;

ALTER TABLE voice_consent_events
  ALTER COLUMN tenant_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_voice_consent_events_tenant_identity
  ON voice_consent_events(tenant_id, identity_type, identity_value, event_at DESC);

CREATE INDEX IF NOT EXISTS idx_voice_consent_events_tenant_callback_phone
  ON voice_consent_events(tenant_id, callback_phone, event_at DESC);

CREATE INDEX IF NOT EXISTS idx_voice_consent_events_tenant_customer
  ON voice_consent_events(tenant_id, customer_id, event_at DESC);
