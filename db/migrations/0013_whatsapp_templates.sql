CREATE TABLE IF NOT EXISTS whatsapp_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL DEFAULT 'meta',
  name text NOT NULL,
  language text NOT NULL DEFAULT 'en_US',
  category text,
  status text NOT NULL DEFAULT 'active',
  components jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, name, language)
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_templates_status
  ON whatsapp_templates(status);
