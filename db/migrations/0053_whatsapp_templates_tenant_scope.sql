ALTER TABLE whatsapp_templates
  DROP CONSTRAINT IF EXISTS whatsapp_templates_provider_name_language_key;

CREATE UNIQUE INDEX IF NOT EXISTS idx_whatsapp_templates_tenant_provider_name_language
  ON whatsapp_templates (tenant_key, workspace_key, provider, name, language);

CREATE INDEX IF NOT EXISTS idx_whatsapp_templates_tenant_status
  ON whatsapp_templates (tenant_key, workspace_key, status);
