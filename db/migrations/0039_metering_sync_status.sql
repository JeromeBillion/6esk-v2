-- 6esk v2: Add sync status to usage events for metering engine integration

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'workspace_module_usage_events' AND column_name = 'sync_status') THEN
    ALTER TABLE workspace_module_usage_events 
    ADD COLUMN sync_status text NOT NULL DEFAULT 'pending' CHECK (sync_status IN ('pending', 'synced', 'failed')),
    ADD COLUMN synced_at timestamptz NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_workspace_module_usage_events_sync
  ON workspace_module_usage_events (sync_status, created_at ASC);
