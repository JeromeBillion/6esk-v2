ALTER TABLE users
  ADD COLUMN IF NOT EXISTS tenant_key text NOT NULL DEFAULT 'primary',
  ADD COLUMN IF NOT EXISTS workspace_key text NOT NULL DEFAULT 'primary';

ALTER TABLE auth_sessions
  ADD COLUMN IF NOT EXISTS tenant_key text NOT NULL DEFAULT 'primary',
  ADD COLUMN IF NOT EXISTS workspace_key text NOT NULL DEFAULT 'primary';

ALTER TABLE password_resets
  ADD COLUMN IF NOT EXISTS tenant_key text NOT NULL DEFAULT 'primary',
  ADD COLUMN IF NOT EXISTS workspace_key text NOT NULL DEFAULT 'primary';

ALTER TABLE workspace_modules
  DROP CONSTRAINT IF EXISTS workspace_modules_pkey;

ALTER TABLE workspace_modules
  ADD CONSTRAINT workspace_modules_pkey PRIMARY KEY (tenant_key, workspace_key);

ALTER TABLE mailboxes
  ADD COLUMN IF NOT EXISTS tenant_key text NOT NULL DEFAULT 'primary',
  ADD COLUMN IF NOT EXISTS workspace_key text NOT NULL DEFAULT 'primary';

ALTER TABLE mailbox_memberships
  ADD COLUMN IF NOT EXISTS tenant_key text NOT NULL DEFAULT 'primary',
  ADD COLUMN IF NOT EXISTS workspace_key text NOT NULL DEFAULT 'primary';

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS tenant_key text NOT NULL DEFAULT 'primary',
  ADD COLUMN IF NOT EXISTS workspace_key text NOT NULL DEFAULT 'primary';

ALTER TABLE attachments
  ADD COLUMN IF NOT EXISTS tenant_key text NOT NULL DEFAULT 'primary',
  ADD COLUMN IF NOT EXISTS workspace_key text NOT NULL DEFAULT 'primary';

ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS tenant_key text NOT NULL DEFAULT 'primary',
  ADD COLUMN IF NOT EXISTS workspace_key text NOT NULL DEFAULT 'primary';

ALTER TABLE ticket_events
  ADD COLUMN IF NOT EXISTS tenant_key text NOT NULL DEFAULT 'primary',
  ADD COLUMN IF NOT EXISTS workspace_key text NOT NULL DEFAULT 'primary';

ALTER TABLE replies
  ADD COLUMN IF NOT EXISTS tenant_key text NOT NULL DEFAULT 'primary',
  ADD COLUMN IF NOT EXISTS workspace_key text NOT NULL DEFAULT 'primary';

ALTER TABLE audit_logs
  ADD COLUMN IF NOT EXISTS tenant_key text NOT NULL DEFAULT 'primary',
  ADD COLUMN IF NOT EXISTS workspace_key text NOT NULL DEFAULT 'primary';

ALTER TABLE sla_configs
  ADD COLUMN IF NOT EXISTS tenant_key text NOT NULL DEFAULT 'primary',
  ADD COLUMN IF NOT EXISTS workspace_key text NOT NULL DEFAULT 'primary';

CREATE INDEX IF NOT EXISTS idx_sla_configs_tenant_active_created
  ON sla_configs (tenant_key, is_active, created_at DESC);

ALTER TABLE csat_ratings
  ADD COLUMN IF NOT EXISTS tenant_key text NOT NULL DEFAULT 'primary',
  ADD COLUMN IF NOT EXISTS workspace_key text NOT NULL DEFAULT 'primary';

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS tenant_key text NOT NULL DEFAULT 'primary',
  ADD COLUMN IF NOT EXISTS workspace_key text NOT NULL DEFAULT 'primary';

ALTER TABLE customer_identities
  ADD COLUMN IF NOT EXISTS tenant_key text NOT NULL DEFAULT 'primary',
  ADD COLUMN IF NOT EXISTS workspace_key text NOT NULL DEFAULT 'primary';

ALTER TABLE ticket_merges
  ADD COLUMN IF NOT EXISTS tenant_key text NOT NULL DEFAULT 'primary',
  ADD COLUMN IF NOT EXISTS workspace_key text NOT NULL DEFAULT 'primary';

ALTER TABLE customer_merges
  ADD COLUMN IF NOT EXISTS tenant_key text NOT NULL DEFAULT 'primary',
  ADD COLUMN IF NOT EXISTS workspace_key text NOT NULL DEFAULT 'primary';

ALTER TABLE merge_review_tasks
  ADD COLUMN IF NOT EXISTS tenant_key text NOT NULL DEFAULT 'primary',
  ADD COLUMN IF NOT EXISTS workspace_key text NOT NULL DEFAULT 'primary';

ALTER TABLE ticket_links
  ADD COLUMN IF NOT EXISTS tenant_key text NOT NULL DEFAULT 'primary',
  ADD COLUMN IF NOT EXISTS workspace_key text NOT NULL DEFAULT 'primary';

ALTER TABLE external_user_links
  ADD COLUMN IF NOT EXISTS tenant_key text NOT NULL DEFAULT 'primary',
  ADD COLUMN IF NOT EXISTS workspace_key text NOT NULL DEFAULT 'primary';

ALTER TABLE tags
  ADD COLUMN IF NOT EXISTS tenant_key text NOT NULL DEFAULT 'primary',
  ADD COLUMN IF NOT EXISTS workspace_key text NOT NULL DEFAULT 'primary';

ALTER TABLE ticket_tags
  ADD COLUMN IF NOT EXISTS tenant_key text NOT NULL DEFAULT 'primary',
  ADD COLUMN IF NOT EXISTS workspace_key text NOT NULL DEFAULT 'primary';

CREATE INDEX IF NOT EXISTS idx_ticket_tags_tenant_ticket
  ON ticket_tags (tenant_key, ticket_id);

ALTER TABLE tags
  DROP CONSTRAINT IF EXISTS tags_name_key;

CREATE UNIQUE INDEX IF NOT EXISTS idx_tags_tenant_name_unique
  ON tags (tenant_key, name);

ALTER TABLE macros
  ADD COLUMN IF NOT EXISTS tenant_key text NOT NULL DEFAULT 'primary',
  ADD COLUMN IF NOT EXISTS workspace_key text NOT NULL DEFAULT 'primary';

ALTER TABLE support_saved_views
  ADD COLUMN IF NOT EXISTS tenant_key text NOT NULL DEFAULT 'primary',
  ADD COLUMN IF NOT EXISTS workspace_key text NOT NULL DEFAULT 'primary';

DROP INDEX IF EXISTS uq_support_saved_views_user_name;

CREATE UNIQUE INDEX IF NOT EXISTS idx_support_saved_views_tenant_user_name_unique
  ON support_saved_views (tenant_key, user_id, lower(name));

DROP INDEX IF EXISTS idx_support_saved_views_user_updated;

CREATE INDEX IF NOT EXISTS idx_support_saved_views_tenant_user_updated
  ON support_saved_views (tenant_key, user_id, updated_at DESC);

ALTER TABLE inbound_events
  ADD COLUMN IF NOT EXISTS tenant_key text NOT NULL DEFAULT 'primary',
  ADD COLUMN IF NOT EXISTS workspace_key text NOT NULL DEFAULT 'primary';

ALTER TABLE inbound_alerts
  ADD COLUMN IF NOT EXISTS tenant_key text NOT NULL DEFAULT 'primary',
  ADD COLUMN IF NOT EXISTS workspace_key text NOT NULL DEFAULT 'primary';

ALTER TABLE inbound_alerts
  DROP CONSTRAINT IF EXISTS inbound_alerts_alert_type_key;

CREATE UNIQUE INDEX IF NOT EXISTS idx_inbound_alerts_tenant_type_unique
  ON inbound_alerts (tenant_key, alert_type);

ALTER TABLE spam_rules
  ADD COLUMN IF NOT EXISTS tenant_key text NOT NULL DEFAULT 'primary',
  ADD COLUMN IF NOT EXISTS workspace_key text NOT NULL DEFAULT 'primary';

ALTER TABLE inbound_alert_configs
  ADD COLUMN IF NOT EXISTS tenant_key text NOT NULL DEFAULT 'primary',
  ADD COLUMN IF NOT EXISTS workspace_key text NOT NULL DEFAULT 'primary';

DROP INDEX IF EXISTS idx_inbound_alert_configs_single_active;

CREATE UNIQUE INDEX IF NOT EXISTS idx_inbound_alert_configs_tenant_active_unique
  ON inbound_alert_configs (tenant_key, is_active)
  WHERE is_active = true;

ALTER TABLE whatsapp_accounts
  ADD COLUMN IF NOT EXISTS tenant_key text NOT NULL DEFAULT 'primary',
  ADD COLUMN IF NOT EXISTS workspace_key text NOT NULL DEFAULT 'primary';

ALTER TABLE whatsapp_events
  ADD COLUMN IF NOT EXISTS tenant_key text NOT NULL DEFAULT 'primary',
  ADD COLUMN IF NOT EXISTS workspace_key text NOT NULL DEFAULT 'primary';

ALTER TABLE whatsapp_templates
  ADD COLUMN IF NOT EXISTS tenant_key text NOT NULL DEFAULT 'primary',
  ADD COLUMN IF NOT EXISTS workspace_key text NOT NULL DEFAULT 'primary';

ALTER TABLE whatsapp_status_events
  ADD COLUMN IF NOT EXISTS tenant_key text NOT NULL DEFAULT 'primary',
  ADD COLUMN IF NOT EXISTS workspace_key text NOT NULL DEFAULT 'primary';

ALTER TABLE email_outbox_events
  ADD COLUMN IF NOT EXISTS tenant_key text NOT NULL DEFAULT 'primary',
  ADD COLUMN IF NOT EXISTS workspace_key text NOT NULL DEFAULT 'primary';

ALTER TABLE call_sessions
  ADD COLUMN IF NOT EXISTS tenant_key text NOT NULL DEFAULT 'primary',
  ADD COLUMN IF NOT EXISTS workspace_key text NOT NULL DEFAULT 'primary';

ALTER TABLE call_events
  ADD COLUMN IF NOT EXISTS tenant_key text NOT NULL DEFAULT 'primary',
  ADD COLUMN IF NOT EXISTS workspace_key text NOT NULL DEFAULT 'primary';

ALTER TABLE call_outbox_events
  ADD COLUMN IF NOT EXISTS tenant_key text NOT NULL DEFAULT 'primary',
  ADD COLUMN IF NOT EXISTS workspace_key text NOT NULL DEFAULT 'primary';

ALTER TABLE call_transcript_jobs
  ADD COLUMN IF NOT EXISTS tenant_key text NOT NULL DEFAULT 'primary',
  ADD COLUMN IF NOT EXISTS workspace_key text NOT NULL DEFAULT 'primary';

ALTER TABLE call_transcript_ai_jobs
  ADD COLUMN IF NOT EXISTS tenant_key text NOT NULL DEFAULT 'primary',
  ADD COLUMN IF NOT EXISTS workspace_key text NOT NULL DEFAULT 'primary';

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_tenant_id
  ON users (tenant_key, id);

ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_email_key;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_tenant_email_unique
  ON users (tenant_key, email);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_tenant_token
  ON auth_sessions (tenant_key, token_hash);

CREATE UNIQUE INDEX IF NOT EXISTS idx_mailboxes_tenant_id
  ON mailboxes (tenant_key, id);

ALTER TABLE mailboxes
  DROP CONSTRAINT IF EXISTS mailboxes_address_key;

CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_tenant_id
  ON messages (tenant_key, id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tickets_tenant_id
  ON tickets (tenant_key, id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_tenant_id
  ON customers (tenant_key, id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_call_sessions_tenant_id
  ON call_sessions (tenant_key, id);

CREATE INDEX IF NOT EXISTS idx_tickets_tenant_status_created
  ON tickets (tenant_key, workspace_key, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_messages_tenant_ticket_created
  ON messages (tenant_key, workspace_key, ticket_id, created_at);

CREATE INDEX IF NOT EXISTS idx_customers_tenant_updated
  ON customers (tenant_key, workspace_key, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_customer_identities_tenant_value
  ON customer_identities (tenant_key, identity_type, identity_value);

CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant_created
  ON audit_logs (tenant_key, workspace_key, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_email_outbox_events_tenant_status
  ON email_outbox_events (tenant_key, workspace_key, status, next_attempt_at);

CREATE INDEX IF NOT EXISTS idx_call_outbox_events_tenant_status
  ON call_outbox_events (tenant_key, workspace_key, status, next_attempt_at);

CREATE INDEX IF NOT EXISTS idx_whatsapp_events_tenant_status
  ON whatsapp_events (tenant_key, workspace_key, status, next_attempt_at);

CREATE INDEX IF NOT EXISTS idx_inbound_events_tenant_status
  ON inbound_events (tenant_key, workspace_key, status, next_attempt_at);

ALTER TABLE inbound_events
  DROP CONSTRAINT IF EXISTS inbound_events_idempotency_key_key;

CREATE UNIQUE INDEX IF NOT EXISTS idx_inbound_events_tenant_idempotency_unique
  ON inbound_events (tenant_key, idempotency_key);

CREATE UNIQUE INDEX IF NOT EXISTS idx_mailboxes_tenant_address_unique
  ON mailboxes (tenant_key, address);

DROP INDEX IF EXISTS uq_customers_external_identity;

CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_tenant_external_identity_unique
  ON customers (tenant_key, external_system, external_user_id);

ALTER TABLE customer_identities
  DROP CONSTRAINT IF EXISTS customer_identities_identity_type_identity_value_key;

CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_identities_tenant_unique
  ON customer_identities (tenant_key, identity_type, identity_value);

ALTER TABLE external_user_links
  DROP CONSTRAINT IF EXISTS external_user_links_external_system_external_user_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS idx_external_user_links_tenant_unique
  ON external_user_links (tenant_key, external_system, external_user_id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_tenant_key_fkey') THEN
    ALTER TABLE users
      ADD CONSTRAINT users_tenant_key_fkey
      FOREIGN KEY (tenant_key) REFERENCES tenants(tenant_key) ON DELETE RESTRICT;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'mailboxes_workspace_fkey') THEN
    ALTER TABLE mailboxes
      ADD CONSTRAINT mailboxes_workspace_fkey
      FOREIGN KEY (tenant_key, workspace_key) REFERENCES workspaces(tenant_key, workspace_key)
      ON DELETE RESTRICT;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'messages_mailbox_tenant_fkey') THEN
    ALTER TABLE messages
      ADD CONSTRAINT messages_mailbox_tenant_fkey
      FOREIGN KEY (tenant_key, mailbox_id) REFERENCES mailboxes(tenant_key, id)
      ON DELETE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'attachments_message_tenant_fkey') THEN
    ALTER TABLE attachments
      ADD CONSTRAINT attachments_message_tenant_fkey
      FOREIGN KEY (tenant_key, message_id) REFERENCES messages(tenant_key, id)
      ON DELETE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tickets_mailbox_tenant_fkey') THEN
    ALTER TABLE tickets
      ADD CONSTRAINT tickets_mailbox_tenant_fkey
      FOREIGN KEY (tenant_key, mailbox_id) REFERENCES mailboxes(tenant_key, id)
      ON DELETE RESTRICT;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tickets_customer_tenant_fkey') THEN
    ALTER TABLE tickets
      ADD CONSTRAINT tickets_customer_tenant_fkey
      FOREIGN KEY (tenant_key, customer_id) REFERENCES customers(tenant_key, id)
      ON DELETE RESTRICT;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ticket_events_ticket_tenant_fkey') THEN
    ALTER TABLE ticket_events
      ADD CONSTRAINT ticket_events_ticket_tenant_fkey
      FOREIGN KEY (tenant_key, ticket_id) REFERENCES tickets(tenant_key, id)
      ON DELETE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'replies_ticket_tenant_fkey') THEN
    ALTER TABLE replies
      ADD CONSTRAINT replies_ticket_tenant_fkey
      FOREIGN KEY (tenant_key, ticket_id) REFERENCES tickets(tenant_key, id)
      ON DELETE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'customer_identities_customer_tenant_fkey') THEN
    ALTER TABLE customer_identities
      ADD CONSTRAINT customer_identities_customer_tenant_fkey
      FOREIGN KEY (tenant_key, customer_id) REFERENCES customers(tenant_key, id)
      ON DELETE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'call_sessions_ticket_tenant_fkey') THEN
    ALTER TABLE call_sessions
      ADD CONSTRAINT call_sessions_ticket_tenant_fkey
      FOREIGN KEY (tenant_key, ticket_id) REFERENCES tickets(tenant_key, id)
      ON DELETE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'call_events_session_tenant_fkey') THEN
    ALTER TABLE call_events
      ADD CONSTRAINT call_events_session_tenant_fkey
      FOREIGN KEY (tenant_key, call_session_id) REFERENCES call_sessions(tenant_key, id)
      ON DELETE CASCADE;
  END IF;
END $$;
