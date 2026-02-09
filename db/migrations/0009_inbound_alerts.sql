CREATE TABLE inbound_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_type text NOT NULL UNIQUE,
  last_sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
