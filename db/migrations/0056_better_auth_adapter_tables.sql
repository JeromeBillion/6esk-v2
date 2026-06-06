CREATE TABLE IF NOT EXISTS better_auth_users (
  id text PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL,
  email_verified boolean NOT NULL DEFAULT false,
  image text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_better_auth_users_email_unique
  ON better_auth_users (lower(email));

CREATE TABLE IF NOT EXISTS better_auth_sessions (
  id text PRIMARY KEY,
  token text NOT NULL UNIQUE,
  user_id text NOT NULL REFERENCES better_auth_users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  ip_address text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_better_auth_sessions_user_expires
  ON better_auth_sessions (user_id, expires_at DESC);

CREATE TABLE IF NOT EXISTS better_auth_accounts (
  id text PRIMARY KEY,
  provider_id text NOT NULL,
  account_id text NOT NULL,
  user_id text NOT NULL REFERENCES better_auth_users(id) ON DELETE CASCADE,
  access_token text,
  refresh_token text,
  id_token text,
  access_token_expires_at timestamptz,
  refresh_token_expires_at timestamptz,
  scope text,
  password text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider_id, account_id)
);

CREATE INDEX IF NOT EXISTS idx_better_auth_accounts_user
  ON better_auth_accounts (user_id);

CREATE TABLE IF NOT EXISTS better_auth_verifications (
  id text PRIMARY KEY,
  identifier text NOT NULL,
  value text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_better_auth_verifications_identifier
  ON better_auth_verifications (identifier);
