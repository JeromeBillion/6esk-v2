-- 6esk v2: tenant-scoped inbound email event and alert state.
-- Existing pre-v2 rows are assigned to the default tenant for continuity;
-- new inbound processing resolves tenant ownership before writing event ledgers.

ALTER TABLE inbound_events
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE;

UPDATE inbound_events
SET tenant_id = '00000000-0000-0000-0000-000000000001'
WHERE tenant_id IS NULL;

ALTER TABLE inbound_events
  ALTER COLUMN tenant_id SET NOT NULL;

ALTER TABLE inbound_alerts
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE;

UPDATE inbound_alerts
SET tenant_id = '00000000-0000-0000-0000-000000000001'
WHERE tenant_id IS NULL;

ALTER TABLE inbound_alerts
  ALTER COLUMN tenant_id SET NOT NULL;

ALTER TABLE inbound_alert_configs
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE;

UPDATE inbound_alert_configs
SET tenant_id = '00000000-0000-0000-0000-000000000001'
WHERE tenant_id IS NULL;

ALTER TABLE inbound_alert_configs
  ALTER COLUMN tenant_id SET NOT NULL;

ALTER TABLE inbound_events
  DROP CONSTRAINT IF EXISTS inbound_events_idempotency_key_key;

CREATE UNIQUE INDEX IF NOT EXISTS uq_inbound_events_tenant_idempotency
  ON inbound_events(tenant_id, idempotency_key);

CREATE INDEX IF NOT EXISTS idx_inbound_events_tenant_status_next_attempt
  ON inbound_events(tenant_id, status, next_attempt_at);

ALTER TABLE inbound_alerts
  DROP CONSTRAINT IF EXISTS inbound_alerts_alert_type_key;

CREATE UNIQUE INDEX IF NOT EXISTS uq_inbound_alerts_tenant_type
  ON inbound_alerts(tenant_id, alert_type);

DROP INDEX IF EXISTS idx_inbound_alert_configs_single_active;

CREATE UNIQUE INDEX IF NOT EXISTS uq_inbound_alert_configs_tenant_single_active
  ON inbound_alert_configs(tenant_id)
  WHERE is_active = true;
