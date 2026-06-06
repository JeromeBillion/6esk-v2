-- 6esk v2: Add tenant_id to outbox and job queues for module-safe background processing.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'email_outbox_events' AND column_name = 'tenant_id') THEN
    ALTER TABLE email_outbox_events ADD COLUMN tenant_id uuid REFERENCES tenants(id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'call_outbox_events' AND column_name = 'tenant_id') THEN
    ALTER TABLE call_outbox_events ADD COLUMN tenant_id uuid REFERENCES tenants(id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'call_transcript_jobs' AND column_name = 'tenant_id') THEN
    ALTER TABLE call_transcript_jobs ADD COLUMN tenant_id uuid REFERENCES tenants(id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'call_transcript_ai_jobs' AND column_name = 'tenant_id') THEN
    ALTER TABLE call_transcript_ai_jobs ADD COLUMN tenant_id uuid REFERENCES tenants(id);
  END IF;
END $$;

-- Backfill with default tenant
UPDATE email_outbox_events SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
UPDATE call_outbox_events SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
UPDATE call_transcript_jobs SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
UPDATE call_transcript_ai_jobs SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;

-- Enforce NOT NULL
ALTER TABLE email_outbox_events ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE call_outbox_events ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE call_transcript_jobs ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE call_transcript_ai_jobs ALTER COLUMN tenant_id SET NOT NULL;

-- Add indexes for tenant-scoped query performance and module joins
CREATE INDEX idx_email_outbox_events_tenant_id ON email_outbox_events(tenant_id);
CREATE INDEX idx_call_outbox_events_tenant_id ON call_outbox_events(tenant_id);
CREATE INDEX idx_call_transcript_jobs_tenant_id ON call_transcript_jobs(tenant_id);
CREATE INDEX idx_call_transcript_ai_jobs_tenant_id ON call_transcript_ai_jobs(tenant_id);
