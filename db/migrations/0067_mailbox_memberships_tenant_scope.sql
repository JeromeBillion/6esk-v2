ALTER TABLE mailbox_memberships
  ADD COLUMN IF NOT EXISTS tenant_id uuid;

UPDATE mailbox_memberships mm
SET tenant_id = m.tenant_id
FROM mailboxes m
JOIN users u ON u.tenant_id = m.tenant_id
WHERE mm.mailbox_id = m.id
  AND mm.user_id = u.id
  AND mm.tenant_id IS NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM mailbox_memberships WHERE tenant_id IS NULL) THEN
    RAISE EXCEPTION 'mailbox_memberships tenant_id backfill requires mailbox and user to belong to the same tenant';
  END IF;
END $$;

ALTER TABLE mailbox_memberships
  ALTER COLUMN tenant_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'mailbox_memberships_tenant_id_fkey'
  ) THEN
    ALTER TABLE mailbox_memberships
      ADD CONSTRAINT mailbox_memberships_tenant_id_fkey
      FOREIGN KEY (tenant_id)
      REFERENCES tenants(id)
      ON DELETE CASCADE;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_mailboxes_tenant_id_id
  ON mailboxes (tenant_id, id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_users_tenant_id_id
  ON users (tenant_id, id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_mailbox_memberships_tenant_mailbox_user
  ON mailbox_memberships (tenant_id, mailbox_id, user_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'mailbox_memberships_tenant_mailbox_fkey'
  ) THEN
    ALTER TABLE mailbox_memberships
      ADD CONSTRAINT mailbox_memberships_tenant_mailbox_fkey
      FOREIGN KEY (tenant_id, mailbox_id)
      REFERENCES mailboxes (tenant_id, id)
      ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'mailbox_memberships_tenant_user_fkey'
  ) THEN
    ALTER TABLE mailbox_memberships
      ADD CONSTRAINT mailbox_memberships_tenant_user_fkey
      FOREIGN KEY (tenant_id, user_id)
      REFERENCES users (tenant_id, id)
      ON DELETE CASCADE;
  END IF;
END $$;

DROP INDEX IF EXISTS idx_mailbox_memberships_user_id;

CREATE INDEX IF NOT EXISTS idx_mailbox_memberships_tenant_user
  ON mailbox_memberships (tenant_id, user_id, mailbox_id);

CREATE INDEX IF NOT EXISTS idx_mailbox_memberships_tenant_mailbox
  ON mailbox_memberships (tenant_id, mailbox_id);
