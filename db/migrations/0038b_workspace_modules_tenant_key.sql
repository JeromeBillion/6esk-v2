-- 6esk v2: make workspace module configuration tenant-scoped at the key level.

ALTER TABLE workspace_modules DROP CONSTRAINT IF EXISTS workspace_modules_pkey;

ALTER TABLE workspace_modules
  ADD CONSTRAINT workspace_modules_pkey PRIMARY KEY (tenant_id, workspace_key);
