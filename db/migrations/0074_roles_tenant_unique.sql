-- 6esk v2: roles are tenant-owned authorization state, not global names.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM users u
    JOIN roles r ON r.id = u.role_id
    WHERE u.role_id IS NOT NULL
      AND u.tenant_id <> r.tenant_id
  ) THEN
    RAISE EXCEPTION 'users.role_id contains cross-tenant role assignments';
  END IF;
END $$;

ALTER TABLE roles
  DROP CONSTRAINT IF EXISTS roles_name_key;

CREATE UNIQUE INDEX IF NOT EXISTS uq_roles_tenant_name
  ON roles(tenant_id, name);

CREATE UNIQUE INDEX IF NOT EXISTS uq_roles_tenant_id_id
  ON roles(tenant_id, id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_tenant_role_fkey'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_tenant_role_fkey
      FOREIGN KEY (tenant_id, role_id)
      REFERENCES roles(tenant_id, id);
  END IF;
END $$;
