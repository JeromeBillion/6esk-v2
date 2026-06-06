CREATE TABLE inbound_alert_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_url text,
  threshold integer NOT NULL DEFAULT 5,
  window_minutes integer NOT NULL DEFAULT 30,
  cooldown_minutes integer NOT NULL DEFAULT 60,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (threshold > 0),
  CHECK (window_minutes > 0),
  CHECK (cooldown_minutes > 0)
);

CREATE UNIQUE INDEX idx_inbound_alert_configs_single_active
  ON inbound_alert_configs (is_active)
  WHERE is_active = true;
