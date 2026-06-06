-- 6esk v2: Add cost tracking to metering events for FinOps accuracy

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'workspace_module_usage_events' AND column_name = 'cost_cent') THEN
    ALTER TABLE workspace_module_usage_events ADD COLUMN cost_cent numeric(12, 4) DEFAULT 0;
  END IF;
END $$;
