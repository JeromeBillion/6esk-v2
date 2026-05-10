-- Enum for supported email providers
CREATE TYPE email_provider AS ENUM ('google', 'microsoft', 'resend', 'imap');

-- OAuth connections table
CREATE TABLE oauth_connections (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  provider       email_provider NOT NULL,

  -- The email address this connection authenticates for
  email_address  text NOT NULL,

  -- Encrypted tokens (AES-256-GCM)
  access_token_enc   bytea NOT NULL,
  refresh_token_enc  bytea NOT NULL,
  token_iv           bytea NOT NULL,        -- IV for AES-GCM
  token_expires_at   timestamptz,           -- When access_token expires

  -- Provider-specific metadata
  provider_account_id text,                 -- Google: sub, Microsoft: oid
  provider_tenant_id  text,                 -- Microsoft: Azure AD tenant
  scopes              text[] NOT NULL,      -- Granted OAuth scopes

  -- Sync state
  sync_cursor         text,                 -- Provider-specific pagination cursor
  last_sync_at        timestamptz,
  last_sync_error     text,
  sync_status         text NOT NULL DEFAULT 'pending', -- pending | active | paused | revoked | error

  -- Lifecycle
  connected_by        uuid REFERENCES users(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  revoked_at          timestamptz,

  UNIQUE (tenant_id, provider, email_address)
);

CREATE INDEX idx_oauth_connections_tenant ON oauth_connections(tenant_id);
CREATE INDEX idx_oauth_connections_sync ON oauth_connections(sync_status, last_sync_at)
  WHERE sync_status = 'active';

-- Extend mailboxes to track which provider backs them
ALTER TABLE mailboxes
  ADD COLUMN provider email_provider NOT NULL DEFAULT 'resend',
  ADD COLUMN oauth_connection_id uuid REFERENCES oauth_connections(id) ON DELETE SET NULL;
