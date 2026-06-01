ALTER TABLE voice_consent_events
  ADD COLUMN IF NOT EXISTS tenant_key text NOT NULL DEFAULT 'primary',
  ADD COLUMN IF NOT EXISTS workspace_key text NOT NULL DEFAULT 'primary';

UPDATE voice_consent_events consent
SET tenant_key = customer.tenant_key,
    workspace_key = customer.workspace_key
FROM customers customer
WHERE customer.id = consent.customer_id
  AND (
    consent.tenant_key IS DISTINCT FROM customer.tenant_key
    OR consent.workspace_key IS DISTINCT FROM customer.workspace_key
  );

CREATE INDEX IF NOT EXISTS idx_voice_consent_events_tenant_customer
  ON voice_consent_events(tenant_key, workspace_key, customer_id, event_at DESC);

CREATE INDEX IF NOT EXISTS idx_voice_consent_events_tenant_identity
  ON voice_consent_events(tenant_key, workspace_key, identity_type, identity_value, event_at DESC);

CREATE INDEX IF NOT EXISTS idx_voice_consent_events_tenant_callback_phone
  ON voice_consent_events(tenant_key, workspace_key, callback_phone, event_at DESC);
